import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { sendEmail, renderEmail } from "@/lib/email";

// GET — list external entries (with optional ?status= filter).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const rows = await prisma.externalEntry.findMany({
    where: {
      competitionId: params.id,
      ...(status ? { status } : {}),
    },
    orderBy: { filedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ rows });
}

const decisionSchema = z.object({
  entryId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().max(400).optional(),
});

// POST — approve or reject. Approval creates a synthetic Rider row in the
// hosting centre (so the rest of the system renders the start list etc.
// without special-casing externals) + a CompetitionEntry against that
// rider + emails the entrant. Reject emails the rejection reason.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const ext = await prisma.externalEntry.findUnique({
    where: { id: parsed.data.entryId },
    include: { competition: { select: { id: true, centreId: true, name: true, slug: true } } },
  });
  if (!ext || ext.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ext.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (ext.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_DECIDED", currentStatus: ext.status }, { status: 409 });
  }
  if (!ext.verifiedAt) {
    return NextResponse.json({ error: "NOT_YET_VERIFIED", message: "Entrant hasn't confirmed their email." }, { status: 409 });
  }

  if (parsed.data.decision === "reject") {
    await prisma.externalEntry.update({
      where: { id: ext.id },
      data: { status: "rejected", rejectionReason: parsed.data.rejectionReason ?? null, approvedBy: session.userId, approvedAt: new Date() },
    });
    await audit({
      userId: session.userId,
      action: "competition.external_entry_rejected",
      tableName: "externalEntry",
      rowId: ext.id,
      after: { reason: parsed.data.rejectionReason },
    });
    await sendEmail({
      to: ext.email,
      subject: `Your ${ext.competition.name} entry — declined`,
      html: renderEmail({
        centreName: "Equiwings",
        heading: "Entry declined",
        body: `<p>Hi ${ext.firstName},</p>
<p>The organiser declined your entry to <strong>${ext.competition.name}</strong>.</p>
${parsed.data.rejectionReason ? `<p>Reason: ${parsed.data.rejectionReason}</p>` : ""}
<p>If you think this is a mistake, reply to this email and the organiser will be in touch.</p>`,
      }),
      ref: { type: "competition.external_entry_rejected", rowId: ext.id },
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve flow: create a synthetic Rider, then a CompetitionEntry.
  // We mark the Rider with a "external_" prefix on photoUrl-style fields
  // so it's easy to filter externals out of normal centre rosters later.
  const rider = await prisma.rider.create({
    data: {
      centreId: ext.competition.centreId,
      firstName: ext.firstName,
      lastName: ext.lastName,
      mobile: ext.mobile,
      email: ext.email,
      dob: ext.dob ?? new Date("2000-01-01"),
      gender: "other",
      fatherName: ext.parentRelation === "father" ? ext.parentName : null,
      motherName: ext.parentRelation === "mother" ? ext.parentName : null,
      fatherPhone: ext.parentRelation === "father" ? ext.parentPhone : null,
      motherPhone: ext.parentRelation === "mother" ? ext.parentPhone : null,
      emergencyName: ext.parentName ?? `${ext.firstName} ${ext.lastName}`,
      emergencyPhone: ext.parentPhone ?? ext.mobile,
      heightCm: 0,
      weightKg: 0,
      addressPresent: "External entrant",
      pincode: "000000",
      status: "active",
      registrationPaid: true,
      // Parental consent JSON if applicable.
      parentalConsentJson: ext.parentName
        ? JSON.stringify({
            signedAt: ext.filedAt.toISOString(),
            parentName: ext.parentName,
            parentRelation: ext.parentRelation,
            parentPhone: ext.parentPhone,
            via: "external_entry",
            externalEntryId: ext.id,
          })
        : null,
    },
  });

  const entry = await prisma.competitionEntry.create({
    data: {
      competitionId: ext.competition.id,
      riderId: rider.id,
      className: ext.className,
      status: "entered",
      paid: false,
    },
  });

  await prisma.externalEntry.update({
    where: { id: ext.id },
    data: { status: "approved", approvedAt: new Date(), approvedBy: session.userId, approvedEntryId: entry.id },
  });

  await audit({
    userId: session.userId,
    action: "competition.external_entry_approved",
    tableName: "externalEntry",
    rowId: ext.id,
    after: { riderId: rider.id, competitionEntryId: entry.id },
  });

  await sendEmail({
    to: ext.email,
    subject: `You're in! ${ext.competition.name}`,
    html: renderEmail({
      centreName: "Equiwings",
      heading: "Entry confirmed",
      body: `<p>Hi ${ext.firstName},</p>
<p>You're confirmed in <strong>${ext.className}</strong> at <strong>${ext.competition.name}</strong>.</p>
<p>The full schedule, start list, and live results will appear at:</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/scoreboard/${ext.competition.slug}">Scoreboard →</a></p>
<p>The organiser will be in touch with stable allocation, vet check times, and entry-fee payment details.</p>`,
    }),
    ref: { type: "competition.external_entry_approved", rowId: ext.id },
  });

  return NextResponse.json({ ok: true, status: "approved", entryId: entry.id });
}
