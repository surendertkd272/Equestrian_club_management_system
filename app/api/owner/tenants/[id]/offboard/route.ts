import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { sendEmail, renderEmail } from "@/lib/email";

// POST /api/owner/tenants/[id]/offboard — schedule tenant decommission.
// Grace window (default 30 days) lets the customer change their mind or
// download their data. The sweep at lib/sweeps.ts:sweepTenantOffboarding
// hard-deletes everything after the grace expires.
//
// Idempotent: if already scheduled, returns the existing schedule.
const schema = z.object({
  graceDays: z.coerce.number().int().min(0).max(180).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.change_status");
  if (block) return block;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }
  const grace = parsed.data.graceDays ?? 30;

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, status: true, billingEmail: true, offboardingScheduledAt: true },
  });
  if (!org) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (org.offboardingScheduledAt) {
    return NextResponse.json({
      ok: true,
      alreadyScheduled: true,
      scrubAt: new Date(org.offboardingScheduledAt.getTime() + 30 * 86400000),
    });
  }

  const scheduledAt = new Date();
  const scrubAt = new Date(scheduledAt.getTime() + grace * 86400000);

  await prisma.organisation.update({
    where: { id: org.id },
    data: {
      status: "offboarding",
      offboardingScheduledAt: scheduledAt,
      offboardingNotes: parsed.data.notes ?? null,
    },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.tenant_offboarding_scheduled",
    orgId: org.id,
    before: { status: org.status },
    after: { status: "offboarding", scrubAt: scrubAt.toISOString(), graceDays: grace },
  });

  // Tell the billing contact what's happening + how to retrieve data.
  if (org.billingEmail) {
    await sendEmail({
      to: org.billingEmail,
      subject: `Your Equiwings account is scheduled for closure — ${org.name}`,
      html: renderEmail({
        centreName: org.name,
        heading: "Account scheduled for closure",
        body: `<p>Per your request, <strong>${org.name}</strong> will be permanently
deleted on <strong>${scrubAt.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</strong>.</p>
<p>Before that date, you can:</p>
<ul style="line-height:1.8">
  <li><strong>Download all your data</strong> from Account → Export everything (a single JSON file with every record).</li>
  <li><strong>Cancel the closure</strong> by writing to support — we can reverse it any time during the grace window.</li>
</ul>
<p>After the deletion date, your data is irretrievable (some anonymised financial records are kept where the Income Tax Act requires it).</p>`,
      }),
      ref: { type: "tenant.offboarding_scheduled", rowId: org.id },
    });
  }

  return NextResponse.json({ ok: true, scrubAt });
}

// DELETE /api/owner/tenants/[id]/offboard — cancel a scheduled offboarding.
// Restores status to "active" assuming nothing else changed in the meantime.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.change_status");
  if (block) return block;

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, offboardingScheduledAt: true },
  });
  if (!org) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!org.offboardingScheduledAt) {
    return NextResponse.json({ error: "NOT_SCHEDULED" }, { status: 409 });
  }

  await prisma.organisation.update({
    where: { id: org.id },
    data: { status: "active", offboardingScheduledAt: null, offboardingNotes: null },
  });
  await auditOwner({
    actorId: session.ownerId,
    action: "owner.tenant_offboarding_cancelled",
    orgId: org.id,
    before: { status: org.status, scheduledAt: org.offboardingScheduledAt },
    after: { status: "active" },
  });
  return NextResponse.json({ ok: true });
}
