import type { Prisma } from "@prisma/client";
import { AllocConflict } from "@/lib/allocation-guard";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { startOfDayInTz, endOfDayInTz } from "@/lib/tz";

type Tx = Prisma.TransactionClient;

// The rules for putting a horse to work on an exam: the same ones the lesson
// and per-horse allocation paths enforce (app/api/horses/[id]/allocations).
// The horse must be active, out of any drug-withdrawal period, free at that
// time, and under its daily work cap. Run inside a transaction that has
// locked the horse row, so two bookings can't both pass and double-book it.

export async function lockHorse(tx: Tx, horseId: string) {
  await tx.$queryRaw`SELECT id FROM "Horse" WHERE id = ${horseId} FOR UPDATE`;
}

export async function assertHorseCanWork(tx: Tx, horse: { id: string; name: string; status: string }) {
  if (horse.status !== "active") {
    throw new AllocConflict("HORSE_NOT_AVAILABLE", `${horse.name} is ${horse.status} — it can't be booked.`);
  }
  const hold = await tx.medicineUsage.findFirst({
    where: { horseId: horse.id, withdrawalUntil: { gt: new Date() } },
    select: { withdrawalUntil: true },
    orderBy: { withdrawalUntil: "desc" },
  });
  if (hold) {
    throw new AllocConflict(
      "WITHDRAWAL_ACTIVE",
      `${horse.name} is under drug withdrawal until ${hold.withdrawalUntil!.toISOString().slice(0, 10)}.`,
    );
  }
}

// Free at [startAt, endAt), and under the daily cap with this booking added.
// `ignoreId` leaves out the booking being moved.
export async function assertHorseFree(
  tx: Tx,
  horse: { id: string; name: string },
  startAt: Date,
  endAt: Date,
  timeZone: string,
  ignoreId?: string,
) {
  const notSelf = ignoreId ? { id: { not: ignoreId } } : {};
  const overlap = await tx.horseAllocation.findFirst({
    where: { horseId: horse.id, startAt: { lt: endAt }, endAt: { gt: startAt }, ...notSelf },
    select: { purpose: true, startAt: true, endAt: true },
  });
  if (overlap) {
    const t = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone });
    throw new AllocConflict("OVERLAP", `${horse.name} is already booked (${overlap.purpose}) ${t(overlap.startAt)}–${t(overlap.endAt)}.`);
  }
  const sameDay = await tx.horseAllocation.findMany({
    where: { horseId: horse.id, startAt: { gte: startOfDayInTz(startAt, timeZone), lte: endOfDayInTz(startAt, timeZone) }, ...notSelf },
    select: { startAt: true, endAt: true },
  });
  const usedMin =
    sameDay.reduce((n, a) => n + (a.endAt.getTime() - a.startAt.getTime()) / 60000, 0) +
    (endAt.getTime() - startAt.getTime()) / 60000;
  if (usedMin > DEFAULT_WORKLOAD_CAP_MIN) {
    throw new AllocConflict(
      "WORKLOAD_EXCEEDED",
      `This would push ${horse.name} past the daily ${DEFAULT_WORKLOAD_CAP_MIN}-minute work cap (${Math.round(usedMin)} min).`,
    );
  }
}
