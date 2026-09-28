import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { todayYmdForCentre } from "@/lib/centre-tz";
import { BookingError, MAX_RIDERS_PER_DAY, type Ladder } from "@/lib/exam-booking";

// Shared pieces for adding a late rider to a sitting or an exam day that is
// already booked. Before this a rider who registered after the day was
// planned — or turned up on the morning — could only be booked onto a
// separate sitting, with its own queue, outside the day.

type Db = typeof prisma | Prisma.TransactionClient;

// A day that's over is on record; nobody is added to it.
export async function assertNotPast(centreId: string, date: Date) {
  const today = await todayYmdForCentre(centreId);
  if (date.toISOString().slice(0, 10) < today) {
    throw new BookingError("EXAM_IN_PAST", "This exam date has passed — book the rider onto an upcoming exam instead.", 409);
  }
}

export async function assertDayRoom(db: Db, examDayId: string, adding: number) {
  const onDay = await db.exam.count({ where: { sitting: { examDayId } } });
  if (onDay + adding > MAX_RIDERS_PER_DAY) {
    throw new BookingError(
      "DAY_FULL",
      `This exam day already has ${onDay} riders; the most for one day is ${MAX_RIDERS_PER_DAY}.`,
      400,
    );
  }
}

// What a late rider in this sitting is marked against and when: the rubric
// the sitting's riders were pinned to (not a template edited since), and the
// sitting's start time.
export async function sittingDefaults(db: Db, sittingId: string, level: number, ladder: Ladder, fallbackTime: string) {
  const first = await db.exam.findFirst({
    where: { sittingId },
    orderBy: { createdAt: "asc" },
    select: { rubricSnapshotJson: true, time: true },
  });
  return {
    rubric: (first?.rubricSnapshotJson ?? ladder.byRank.get(level)?.categoriesJson ?? null) as Prisma.JsonValue,
    time: first?.time ?? fallbackTime,
  };
}

// The sitting's jury panel as {id, name}, for seating on new exams. A judge
// deactivated since is skipped rather than seated on a card nobody can mark.
export async function panelOf(db: Db, panelJudgeIds: string[]) {
  if (panelJudgeIds.length === 0) return [];
  return db.user.findMany({
    where: { id: { in: panelJudgeIds }, status: "active" },
    select: { id: true, name: true },
  });
}
