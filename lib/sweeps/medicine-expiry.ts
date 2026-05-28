import { prisma } from "../prisma";
import { notify } from "../notify";
import { SweepResult, centreManagerId, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Job 2: Medicine expiry digest.
// One digest notification per centre listing medicines expiring within 30 days.
export async function sweepMedicineExpiry(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const meds = await prisma.medicine.findMany({
    where: { qty: { gt: 0 }, expDate: { lte: cutoff } },
    orderBy: { expDate: "asc" },
    select: { id: true, name: true, batchNo: true, expDate: true, qty: true, centreId: true },
  });

  // Group by centre.
  const byCentre = new Map<string, typeof meds>();
  for (const m of meds) {
    if (!byCentre.has(m.centreId)) byCentre.set(m.centreId, []);
    byCentre.get(m.centreId)!.push(m);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    // Daily digest — one per centre per day.
    if (await recentlyNotified(mgrId, "medicine.expiry_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const preview = list
      .slice(0, 3)
      .map((m) => `${m.name} (${m.batchNo})`)
      .join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "medicine.expiry_digest",
      title: `${list.length} medicine${list.length === 1 ? "" : "s"} expiring within 30 days`,
      body: `${preview}${more}. Review the inventory and rotate / reorder.`,
      link: "/medicines?status=expiring",
      payload: { centreId, count: list.length, ids: list.map((m) => m.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "medicine_expiry", scanned: meds.length, notified, skipped };
}
