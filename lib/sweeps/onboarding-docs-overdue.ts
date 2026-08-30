import { prisma } from "../prisma";
import { notifyCentreManager, notifyMany } from "../notify";
import { pendingItems, parseWaived } from "../onboarding-items";
import { SweepResult } from "./shared";

// Approved hires whose 15-day document deadline has passed with items still
// pending (not filled, not waived) — notify the centre manager + HQ admins once.
export async function sweepOnboardingDocsOverdue(): Promise<SweepResult> {
  const now = new Date();
  const rows = await prisma.employeeOnboarding.findMany({
    where: { status: "approved", documentsDueAt: { lt: now }, overdueNotifiedAt: null },
  });

  let notified = 0;
  let skipped = 0;
  if (rows.length === 0) return { job: "onboarding_docs_overdue", scanned: 0, notified, skipped };

  // HQ admins, resolved PER ORGANISATION.
  //
  // This used to fetch every SUPER_ADMIN/ADMIN on the platform once, with no
  // org filter, and then notify all of them about every overdue row — while
  // `rows` spans every tenant. So one club's HQ received another club's
  // employee name, email and pending-document list, nightly. A cross-tenant
  // leak in a batch job, which is the kind nobody sees because the evidence
  // lands in someone else's notification inbox.
  //
  // Cached per org so a sweep across many tenants stays one query each rather
  // than one per row.
  const hqByOrg = new Map<string, string[]>();
  async function hqAdminsFor(centreId: string): Promise<string[]> {
    const centre = await prisma.centre.findUnique({
      where: { id: centreId },
      select: { orgId: true },
    });
    const orgId = centre?.orgId;
    // Fail closed: with no resolvable org we cannot prove who is entitled to
    // see this, so nobody at HQ gets it. The centre manager is still notified.
    if (!orgId) return [];
    const cached = hqByOrg.get(orgId);
    if (cached) return cached;
    const users = await prisma.user.findMany({
      where: {
        role: { in: ["SUPER_ADMIN", "ADMIN"] },
        status: "active",
        // HQ users carry orgId directly (centreId is null for them); centre
        // staff resolve through their centre. Match either, or the alert goes
        // nowhere for exactly the people who need it.
        OR: [{ orgId }, { centre: { orgId } }],
      },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    hqByOrg.set(orgId, ids);
    return ids;
  }

  for (const ob of rows) {
    const pending = pendingItems(ob as unknown as Record<string, unknown>, parseWaived(ob.waivedItemsJson));
    if (pending.length === 0) {
      // Already complete / fully waived — stamp so we never re-scan it.
      await prisma.employeeOnboarding.update({ where: { id: ob.id }, data: { overdueNotifiedAt: now } });
      skipped += 1;
      continue;
    }
    const title = `Onboarding documents overdue — ${ob.fullName ?? ob.email ?? "employee"}`;
    const body = `${pending.length} item${pending.length === 1 ? "" : "s"} still pending past the deadline: ${pending
      .map((p) => p.label)
      .slice(0, 6)
      .join(", ")}${pending.length > 6 ? "…" : ""}. Follow up or waive what doesn't apply.`;

    await notifyCentreManager(ob.centreId, {
      type: "staff_onboarding.overdue",
      title,
      body,
      link: "/staff/onboarding",
      payload: { onboardingId: ob.id },
    });
    const hqAdmins = await hqAdminsFor(ob.centreId);
    if (hqAdmins.length > 0) {
      await notifyMany(hqAdmins, {
        centreId: ob.centreId,
        type: "staff_onboarding.overdue",
        title,
        body,
        link: "/staff/onboarding",
        payload: { onboardingId: ob.id },
      });
    }
    await prisma.employeeOnboarding.update({ where: { id: ob.id }, data: { overdueNotifiedAt: now } });
    notified += 1;
  }

  return { job: "onboarding_docs_overdue", scanned: rows.length, notified, skipped };
}
