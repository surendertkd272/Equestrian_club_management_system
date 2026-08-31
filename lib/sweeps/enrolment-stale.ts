import { prisma } from "../prisma";
import { notifyCentreManager, notifyHq } from "../notify";
import { SweepResult } from "./shared";

// Self-enrolments nobody has answered.
//
// Two riders sat in pending_approval for over two months — applied 17 June and
// 30 June, never approved, never rejected. Nothing chased them, because no
// sweep looked at this queue at all. A public sign-up form that silently
// swallows applications is worse than not having one: the family believes they
// have joined, and the club never knows they applied.
//
// Nags after 3 days, then weekly, so a queue checked on Monday is not a daily
// irritant but an ignored one keeps surfacing.
const FIRST_NAG_DAYS = 3;

export async function sweepEnrolmentStale(): Promise<SweepResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - FIRST_NAG_DAYS * 86400_000);

  const rows = await prisma.rider.findMany({
    where: {
      status: "pending_approval",
      selfEnrolled: true,
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      centreId: true,
      centre: { select: { name: true, orgId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let notified = 0;
  let skipped = 0;
  if (rows.length === 0) {
    return { job: "enrolment_stale", scanned: 0, notified, skipped };
  }

  // Grouped per centre: one message listing everyone waiting beats one per
  // applicant, which is how a queue of ten becomes ten ignored notifications.
  const byCentre = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCentre.get(r.centreId) ?? [];
    list.push(r);
    byCentre.set(r.centreId, list);
  }

  for (const [centreId, list] of byCentre) {
    // Weekly after the first nag, deduped on the CENTRE rather than the rider
    // — otherwise one new applicant re-notifies about all the old ones.
    //
    // Deliberately not recentlyNotified(): that keys on a userId, and the
    // recipients here are "whoever manages this centre" plus HQ, which is not
    // a single stable id. Asking "was anyone told about this centre lately"
    // is the question that actually prevents a nightly nag.
    const alreadyNagged = await prisma.notification.findFirst({
      where: {
        type: "enrolment.stale",
        centreId,
        createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (alreadyNagged) {
      skipped += list.length;
      continue;
    }
    const oldest = list[0];
    const days = Math.floor((now.getTime() - oldest.createdAt.getTime()) / 86400_000);
    const title = `${list.length} enrolment${list.length === 1 ? "" : "s"} waiting at ${oldest.centre.name}`;
    const body =
      `The oldest has been waiting ${days} days (${oldest.firstName} ${oldest.lastName}). ` +
      `Approve or reject them — an application nobody answers looks to the family like they have joined.`;

    await notifyCentreManager(centreId, {
      type: "enrolment.stale",
      title,
      body,
      link: "/enrolments",
      payload: { centreId, count: list.length },
    });
    // HQ too, resolved by org — a centre with no manager assigned is exactly
    // the case where these pile up unseen.
    if (oldest.centre.orgId) {
      await notifyHq(oldest.centre.orgId, {
        centreId,
        type: "enrolment.stale",
        title,
        body,
        link: "/enrolments",
      });
    }
    notified += list.length;
  }

  return { job: "enrolment_stale", scanned: rows.length, notified, skipped };
}
