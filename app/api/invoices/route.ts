import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession } from "@/lib/features-gate";
import { tracksDues } from "@/lib/money-contact";

// Raise a due by hand.
//
// Until now invoices could only appear from two places — enrolment approval
// and event registration — so a club tracking dues internally could record
// what the system happened to generate and nothing else. No monthly coaching
// fee, no one-off charge, no correction. There was no create-invoice endpoint
// anywhere in the app.
//
// Raising a due NEVER contacts the family. That is the whole point of the
// internal mode, and it is why this endpoint sends nothing: the decision about
// contact lives in lib/money-contact.ts and is made on the surfaces that
// actually message people, not scattered through every writer.

const KINDS = ["registration", "monthly", "exam", "event", "other"] as const;

const schema = z.object({
  riderId: z.string().min(1),
  // No ceiling beyond sanity. Fees range from a coaching month to an annual
  // membership, and the club decides what it is owed — not the software.
  amount: z.number().positive().max(10_000_000),
  gstAmount: z.number().min(0).max(10_000_000).default(0),
  kind: z.enum(KINDS).default("other"),
  dueDate: z.string(),
  note: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  if (!(await tracksDues(orgId))) {
    return NextResponse.json(
      {
        error: "FEATURE_OFF",
        message: "This club doesn't track dues. Turn on Internal Dues Tracking first.",
      },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Pick a rider, an amount and a due date." },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const dueDate = new Date(d.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: "VALIDATION", message: "That due date isn't valid." }, { status: 400 });
  }

  // The rider decides the centre. A centreId from the client would let a due
  // be filed against a club the caller cannot see.
  const rider = await prisma.rider.findFirst({
    where: {
      id: d.riderId,
      centre: { orgId },
      ...(session.centreId ? { centreId: session.centreId } : {}),
    },
    select: { id: true, centreId: true, firstName: true, lastName: true },
  });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const invoice = await prisma.invoice.create({
    data: {
      centreId: rider.centreId,
      riderId: rider.id,
      amount: d.amount,
      gstAmount: d.gstAmount,
      dueDate,
      kind: d.kind,
      status: "due",
    },
  });

  await audit({
    userId: session.userId,
    action: "invoice.created_manually",
    tableName: "invoice",
    rowId: invoice.id,
    after: {
      rider: `${rider.firstName} ${rider.lastName}`,
      amount: d.amount,
      gstAmount: d.gstAmount,
      kind: d.kind,
      note: d.note ?? null,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, id: invoice.id, amount: invoice.amount });
}
