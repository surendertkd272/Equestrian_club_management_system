import { prisma } from "../prisma";
import { notify } from "../notify";
import { SweepResult, centreManagerId, recentlyNotified } from "./shared";

// Job 2d: Vaccination due digest. Horses with nextDueAt within 30 days roll up
// into one notification per centre.
export async function sweepVaccinationDue(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() + 30 * 86400000);

  const rows = await prisma.vaccinationSchedule.findMany({
    where: { nextDueAt: { lte: cutoff } },
    orderBy: { nextDueAt: "asc" },
    select: {
      id: true,
      centreId: true,
      vaccineLabel: true,
      nextDueAt: true,
      horse: { select: { name: true, stableNo: true } },
    },
  });

  const byCentre = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byCentre.has(r.centreId)) byCentre.set(r.centreId, []);
    byCentre.get(r.centreId)!.push(r);
  }

  let notified = 0;
  let skipped = 0;
  for (const [centreId, list] of byCentre.entries()) {
    const mgrId = await centreManagerId(centreId);
    if (!mgrId) { skipped += 1; continue; }
    if (await recentlyNotified(mgrId, "vaccination.due_digest", centreId, 23 * 60 * 60 * 1000)) {
      skipped += 1; continue;
    }
    const preview = list.slice(0, 3)
      .map((r) => `${r.horse.name} · ${r.vaccineLabel}`).join(", ");
    const more = list.length > 3 ? ` + ${list.length - 3} more` : "";
    await notify({
      userId: mgrId,
      centreId,
      type: "vaccination.due_digest",
      title: `${list.length} vaccination${list.length === 1 ? "" : "s"} due within 30 days`,
      body: `${preview}${more}.`,
      link: "/vaccinations",
      payload: { count: list.length, ids: list.map((r) => r.id).slice(0, 20) },
    });
    notified += 1;
  }

  return { job: "vaccination_due", scanned: rows.length, notified, skipped };
}
