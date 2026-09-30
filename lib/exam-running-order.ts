import type { Prisma } from "@prisma/client";
import { AllocConflict } from "@/lib/allocation-guard";
import { assertHorseFree } from "@/lib/horse-availability";
import { parseWallTimeInTz } from "@/lib/tz";

type Tx = Prisma.TransactionClient;

// A sitting's running order: who rides when. Every rider in a sitting used to
// carry the day's start time, so 120 families were all told "08:00". A running
// order gives each rider a place and a slot; a horse can then be booked for
// each slot (lib/horse-availability.ts), since a horse needs a time to be
// free at.

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Slot start times for n riders: every `slot` minutes from `start`, with a
// `breakMinutes` pause after every `breakEvery` riders. Null if it runs past
// midnight.
export function slotTimes(
  n: number,
  opts: { start: string; slotMinutes: number; breakEvery?: number | null; breakMinutes?: number | null },
): string[] | null {
  const out: string[] = [];
  let t = toMinutes(opts.start);
  for (let i = 0; i < n; i++) {
    if (i > 0 && opts.breakEvery && opts.breakMinutes && i % opts.breakEvery === 0) t += opts.breakMinutes;
    if (t + opts.slotMinutes > 24 * 60) return null;
    out.push(toHHMM(t));
    t += opts.slotMinutes;
  }
  return out;
}

// "08:30" shifted by `delta` minutes, clamped to the day.
export function shiftTime(hhmm: string, delta: number): string {
  return toHHMM(Math.min(24 * 60 - 1, Math.max(0, toMinutes(hhmm) + delta)));
}

// Put riders on the end of a sitting's running order, each with the next slot
// (a late rider, or one who turned up after being marked absent). No-op when
// the sitting has no running order yet.
export async function appendToRunningOrderTx(tx: Tx, sittingId: string, examIds: string[]) {
  if (examIds.length === 0) return;
  const sitting = await tx.examSitting.findUnique({ where: { id: sittingId }, select: { slotMinutes: true } });
  if (!sitting?.slotMinutes) return;
  const last = await tx.exam.findFirst({
    where: { sittingId, runOrder: { not: null }, id: { notIn: examIds } },
    orderBy: { runOrder: "desc" },
    select: { runOrder: true, time: true },
  });
  if (!last?.runOrder) return;
  for (const [i, id] of examIds.entries()) {
    await tx.exam.update({
      where: { id },
      data: { runOrder: last.runOrder + i + 1, time: shiftTime(last.time, sitting.slotMinutes * (i + 1)) },
    });
  }
}

// When a rider's slot starts and ends, in the centre's zone. `date` is the
// exam's date-only value (UTC midnight or noon — both carry the right day).
export function slotWindow(date: Date, time: string, slotMinutes: number, timeZone: string) {
  const startAt = parseWallTimeInTz(`${date.toISOString().slice(0, 10)}T${time}`, timeZone);
  return { startAt, endAt: new Date(startAt.getTime() + slotMinutes * 60000) };
}

// Move each exam's booked horse to the exam's current slot. A horse that is
// no longer free (the new slot clashes, or busts its daily cap) is released
// rather than double-booked, and reported so the manager can pick another.
//
// Two passes: every moved booking takes its new slot first, then each is
// checked. Checking one at a time against neighbours that hadn't moved yet
// made a whole shifted running order clash with its own old slots.
export async function syncExamHorsesTx(
  tx: Tx,
  examIds: string[],
  timeZone: string,
): Promise<{ examId: string; horse: string; reason: string }[]> {
  if (examIds.length === 0) return [];
  const exams = await tx.exam.findMany({
    where: { id: { in: examIds } },
    select: {
      id: true, date: true, time: true, status: true,
      sitting: { select: { slotMinutes: true } },
      horseAllocation: { select: { id: true, horse: { select: { id: true, name: true } } } },
    },
  });
  const moved: { examId: string; allocId: string; horse: { id: string; name: string }; startAt: Date; endAt: Date }[] = [];
  for (const e of exams) {
    const a = e.horseAllocation;
    if (!a) continue;
    if (e.status === "absent" || !e.sitting?.slotMinutes) {
      await tx.horseAllocation.delete({ where: { id: a.id } });
      continue;
    }
    const { startAt, endAt } = slotWindow(e.date, e.time, e.sitting.slotMinutes, timeZone);
    await tx.horseAllocation.update({ where: { id: a.id }, data: { startAt, endAt } });
    moved.push({ examId: e.id, allocId: a.id, horse: a.horse, startAt, endAt });
  }
  const released: { examId: string; horse: string; reason: string }[] = [];
  for (const m of moved.sort((x, y) => x.startAt.getTime() - y.startAt.getTime())) {
    try {
      await assertHorseFree(tx, m.horse, m.startAt, m.endAt, timeZone, m.allocId);
    } catch (err) {
      if (!(err instanceof AllocConflict)) throw err;
      await tx.horseAllocation.delete({ where: { id: m.allocId } });
      released.push({ examId: m.examId, horse: m.horse.name, reason: err.message });
    }
  }
  return released;
}
