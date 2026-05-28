import { prisma } from "../prisma";
import { notify } from "../notify";
import { SweepResult, centreManagerId, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Job 2b: Horse insurance expiry digest.
// PDF §4 — Insurance Records. Flags any horse whose policy is within 30 days
// of validTo, or already expired. One digest per centre per day so managers
// can chase renewals before the cover lapses.
export async function sweepHorseInsuranceExpiry(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const horses = await prisma.horse.findMany({
    where: {
      status: { not: "retired" },
      insuranceValidTo: { lte: cutoff, not: null },
    },
    orderBy: { insuranceValidTo: "asc" },
    select: {
      id: true,
      name: true,
      stableNo: true,
      insurerName: true,
      insuranceValidTo: true,
      centreId: true,
    },
  });

  const byCentre = new Map<string, typeof horses>();
  for (const h of horses) {
    if (!byCentre.has(h.centreId)) byCentre.set(h.centreId, []);
    byCentre.get(h.centreId)!.push(h);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "horse.insurance_expiry_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const preview = list
      .slice(0, 3)
      .map((h) => `${h.name}${h.stableNo ? ` (${h.stableNo})` : ""}`)
      .join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "horse.insurance_expiry_digest",
      title: `${list.length} horse${list.length === 1 ? "'s" : "s'"} insurance expiring within 30 days`,
      body: `${preview}${more}. Contact your insurer to renew.`,
      link: "/horses",
      payload: { centreId, count: list.length, ids: list.map((h) => h.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "horse_insurance_expiry", scanned: horses.length, notified, skipped };
}
