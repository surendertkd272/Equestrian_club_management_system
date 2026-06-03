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

  const hqAdmins = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, status: "active" },
    select: { id: true },
  });

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
    if (hqAdmins.length > 0) {
      await notifyMany(hqAdmins.map((u) => u.id), {
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
