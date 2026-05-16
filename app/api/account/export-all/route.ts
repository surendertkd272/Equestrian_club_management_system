import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

// GET /api/account/export-all — one-shot full export for the caller's
// tenant. Available to SUPER_ADMIN + CENTRE_MANAGER. Returns a single
// JSON document containing every row that's scoped to this org. Used
// for DPDPA Section 11 data portability and tenant offboarding.
//
// The response is large (potentially MBs) — we stream as a single JSON
// blob rather than chunked because most data layers (jq, Excel via
// power-query, custom scripts) prefer a single document. For very large
// tenants (>50k riders) the row caps below prevent OOM; the operator
// can request a paginated export by date range as a follow-up.
//
// We resolve the org via the user's centre (centre-scoped) or User.orgId
// (HQ SUPER_ADMIN). Centre-scoped users only get their own centre's data;
// HQ users get the whole org.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { centreId: true, orgId: true, centre: { select: { orgId: true } } },
  });
  // HQ users have orgId set directly; centre-scoped users derive it via centre.orgId.
  const orgId = me?.orgId ?? me?.centre?.orgId ?? null;
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 400 });

  // SUPER_ADMIN sees all org centres; CENTRE_MANAGER restricted to their centre.
  const centreFilter =
    session.role === "SUPER_ADMIN" ? undefined : session.centreId ? { centreId: session.centreId } : undefined;

  // Pre-compute the centre id set for filters that need direct centreId
  // membership (no centre relation on the row).
  const allCentreIds = (await prisma.centre.findMany({ where: { orgId }, select: { id: true } })).map((c) => c.id);
  const centreIdSet = centreFilter ? [centreFilter.centreId] : allCentreIds;

  // Each entity capped at 50k rows. Customers with bigger volumes should
  // request paginated exports; the cap stops one huge tenant from OOM-ing
  // the export route on smaller dynos.
  const TAKE = 50_000;

  const [
    org,
    centres,
    users,
    riders,
    horses,
    batches,
    attendance,
    skills,
    exams,
    competitions,
    competitionEntries,
    events,
    eventRegistrations,
    certificates,
    accreditations,
    invoices,
    payments,
    expenses,
    vendors,
    medicines,
    medicineUsage,
    farrierVisits,
    vaccinations,
    injuries,
    feedPlans,
    lessons,
    horseAllocations,
    parentLinks,
    feePlans,
    auditLog,
  ] = await Promise.all([
    prisma.organisation.findUnique({ where: { id: orgId } }),
    prisma.centre.findMany({ where: { orgId } }),
    prisma.user.findMany({
      where: centreFilter ?? { OR: [{ orgId }, { centre: { orgId } }] },
      // Strip passwordHash + tokenVersion — both are sensitive operational state.
      select: {
        id: true, name: true, email: true, phone: true, role: true, centreId: true, orgId: true,
        status: true, twoFactor: true, mustChangePassword: true, photoUrl: true,
        emailVerifiedAt: true, deletionRequestedAt: true, createdAt: true, updatedAt: true,
      },
      take: TAKE,
    }),
    prisma.rider.findMany({
      where: centreFilter ?? { centre: { orgId } },
      take: TAKE,
    }),
    prisma.horse.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.batch.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.attendance.findMany({ where: centreFilter ? { rider: centreFilter } : { rider: { centre: { orgId } } }, take: TAKE }),
    prisma.riderSkillStatus.findMany({ where: centreFilter ? { rider: centreFilter } : { rider: { centre: { orgId } } }, take: TAKE }),
    prisma.exam.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.competition.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.competitionEntry.findMany({ where: centreFilter ? { competition: centreFilter } : { competition: { centre: { orgId } } }, take: TAKE }),
    prisma.event.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.eventRegistration.findMany({ where: centreFilter ? { event: centreFilter } : { event: { centre: { orgId } } }, take: TAKE }),
    prisma.certificate.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.accreditation.findMany({ where: centreFilter ? { rider: centreFilter } : { rider: { centre: { orgId } } }, take: TAKE }),
    prisma.invoice.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.payment.findMany({ where: centreFilter ? { invoice: centreFilter } : { invoice: { centre: { orgId } } }, take: TAKE }),
    prisma.expense.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.vendor.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.medicine.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.medicineUsage.findMany({ where: centreFilter ? { horse: centreFilter } : { horse: { centre: { orgId } } }, take: TAKE }),
    prisma.farrierVisit.findMany({ where: centreFilter ? { horse: centreFilter } : { horse: { centre: { orgId } } }, take: TAKE }),
    prisma.vaccinationSchedule.findMany({ where: centreFilter ? { horse: centreFilter } : { horse: { centre: { orgId } } }, take: TAKE }),
    prisma.injuryLog.findMany({ where: { centreId: { in: centreIdSet } }, take: TAKE }),
    prisma.feedPlan.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.lesson.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.horseAllocation.findMany({ where: centreFilter ? { horse: centreFilter } : { horse: { centre: { orgId } } }, take: TAKE }),
    prisma.parentLink.findMany({ where: centreFilter ? { rider: centreFilter } : { rider: { centre: { orgId } } }, take: TAKE }),
    prisma.feePlan.findMany({ where: centreFilter ?? { centre: { orgId } }, take: TAKE }),
    prisma.auditLog.findMany({
      where: centreFilter ? { user: { centreId: centreFilter.centreId } } : { OR: [{ user: { orgId } }, { user: { centre: { orgId } } }] },
      orderBy: { at: "desc" },
      take: TAKE,
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "account.full_export",
    tableName: "organisation",
    rowId: orgId,
    after: { centreScope: centreFilter ? "single-centre" : "whole-org", at: new Date().toISOString() },
  });

  const filename = `equiwings-export-${(org?.slug ?? orgId).slice(0, 30)}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(
    JSON.stringify({
      exportedAt: new Date().toISOString(),
      orgId,
      scope: centreFilter ? "single-centre" : "whole-org",
      cap: TAKE,
      note: "DPDPA data portability export. Sensitive fields (passwordHash, tokenVersion) deliberately excluded.",
      organisation: org,
      centres,
      users,
      riders,
      horses,
      batches,
      attendance,
      skills,
      exams,
      competitions,
      competitionEntries,
      events,
      eventRegistrations,
      certificates,
      accreditations,
      invoices,
      payments,
      expenses,
      vendors,
      medicines,
      medicineUsage,
      farrierVisits,
      vaccinations,
      injuries,
      feedPlans,
      lessons,
      horseAllocations,
      parentLinks,
      feePlans,
      auditLog,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
