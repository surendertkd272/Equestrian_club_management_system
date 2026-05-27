// Issue a SeparationNotice against a user (kind = termination or
// resignation_request). The user then sees the notice on their own
// /account/separation page, writes their response, and submits — at
// which point we flip User.status to resigned or terminated.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const issueSchema = z.object({
  kind: z.enum(["termination", "resignation_request"]),
  noticeText: z.string().min(10).max(2000),
  effectiveAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Only HQ admins issue separation notices. Centre managers don't get
  // this privilege — it's an HR-level decision and we want a clean
  // audit trail with HQ accountability.
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, centreId: true, status: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Refuse to issue separation against active SUPER_ADMIN / ADMIN — those
  // require a separate HQ-team handoff. Centre-tier staff are fine.
  if (target.role === "SUPER_ADMIN" || target.role === "ADMIN") {
    return NextResponse.json({ error: "CANNOT_SEPARATE_HQ_USER" }, { status: 400 });
  }
  if (target.status !== "active") {
    return NextResponse.json({ error: "USER_NOT_ACTIVE", status: target.status }, { status: 409 });
  }

  const notice = await prisma.separationNotice.create({
    data: {
      userId: target.id,
      centreId: target.centreId,
      kind: parsed.data.kind,
      noticeText: parsed.data.noticeText,
      issuedByUserId: session.userId,
      effectiveAt: parsed.data.effectiveAt
        ? new Date(parsed.data.effectiveAt)
        : new Date(Date.now() + 30 * 86400000),
    },
  });

  await audit({
    userId: session.userId,
    action: `user.${parsed.data.kind}`,
    tableName: "separationNotice",
    rowId: notice.id,
    after: { targetUserId: target.id, targetName: target.name, kind: parsed.data.kind },
  });

  // Critical-criticality notification so it doesn't get muted out — the
  // recipient needs to see this regardless of their notif prefs.
  await notify({
    userId: target.id,
    centreId: target.centreId,
    type: `separation.${parsed.data.kind}`,
    title: parsed.data.kind === "termination"
      ? "Termination notice issued"
      : "Resignation form available",
    body: parsed.data.kind === "termination"
      ? "An admin has issued a termination notice. Please review and provide your acknowledgement at /account/separation."
      : "Please submit your resignation reason at /account/separation.",
    link: "/account/separation",
    criticality: "critical",
  });

  return NextResponse.json({ ok: true, id: notice.id });
}

// Withdraw a pending notice (admin changes their mind before the user submits).
const withdrawSchema = z.object({ noticeId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const notice = await prisma.separationNotice.findUnique({
    where: { id: parsed.data.noticeId },
  });
  if (!notice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (notice.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }

  await prisma.separationNotice.update({
    where: { id: notice.id },
    data: { status: "withdrawn" },
  });
  await audit({
    userId: session.userId,
    action: "user.separation_withdraw",
    tableName: "separationNotice",
    rowId: notice.id,
    before: { status: "pending" },
    after: { status: "withdrawn" },
  });
  return NextResponse.json({ ok: true });
}
