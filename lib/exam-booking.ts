import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth";
import { ENROLLED_RIDER_STATUSES, riderBlockedReason } from "@/lib/rider-status";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";

// ─── Booking riders onto exams ──────────────────────────────────────────────
// One set of rules for every way an exam gets booked — a single sitting
// (/api/exam-sittings) and a whole exam day (/api/exam-days) — so the two can
// never disagree about who may sit what.

type Db = PrismaClient | Prisma.TransactionClient;

// A sitting was capped at 50 riders, so a 200-rider exam day meant five
// separate bookings. The claim pool works at any size; these caps only guard
// against a runaway request.
export const MAX_RIDERS_PER_SITTING = 200;
export const MAX_RIDERS_PER_DAY = 500;
export const MAX_EXAMINERS_PER_POOL = 12;

export type BookingEntry = { riderId: string; level: number };

export class BookingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

// Why a rider can't be booked, for a human — or null when they can.
//
// Exams are riding: the same rule as the coach's register applies. A rider
// held for consent (a spreadsheet can't carry a signature) was hidden from the
// booking screen with no explanation while the API booked them anyway.
export function bookingBlockReason(status: string): string | null {
  if ((ENROLLED_RIDER_STATUSES as readonly string[]).includes(status)) return null;
  return (
    riderBlockedReason(status) ??
    `This rider is ${status.replaceAll("_", " ")} — only enrolled riders can sit an exam.`
  );
}

const nameList = (names: string[], max = 8) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

// A club's level ladder: template level name → rank ("1".."n"), plus the
// template per rank.
export async function levelLadder(db: Db, centreId: string) {
  const templates = await db.scoringTemplate.findMany({
    where: { centreId },
    select: { levelKey: true, levelName: true, categoriesJson: true, passThreshold: true },
  });
  const byName = new Map<string, number>();
  const byRank = new Map<number, (typeof templates)[number]>();
  for (const t of templates) {
    const rank = Number(t.levelKey);
    if (!Number.isFinite(rank)) continue;
    byName.set(t.levelName, rank);
    byRank.set(rank, t);
  }
  return { byName, byRank };
}
export type Ladder = Awaited<ReturnType<typeof levelLadder>>;

// Where a rider stands on the ladder: 0 with no level yet, null when their
// level isn't one this club's ladder knows (a free-text level typed on the
// profile) — we can't tell what they're ready for, so we don't block them.
export function riderRank(ladder: Ladder, currentLevel: string | null): number | null {
  if (!currentLevel) return 0;
  return ladder.byName.get(currentLevel) ?? null;
}

// The level a rider should sit next, capped at the top of the ladder.
export function suggestedLevel(ladder: Ladder, currentLevel: string | null): number | null {
  const rank = riderRank(ladder, currentLevel);
  if (rank === null) return null;
  const top = Math.max(0, ...ladder.byRank.keys());
  return top === 0 ? null : Math.min(rank + 1, top);
}

// Resolve and check an examiner pool: active EXAMINERs of this centre (a
// SUPER_ADMIN may staff across centres).
export async function examinerPool(db: Db, session: SessionPayload, centreId: string, ids: string[]) {
  const unique = Array.from(new Set(ids));
  const users = await db.user.findMany({
    where: { id: { in: unique }, status: "active" },
    select: { id: true, name: true, role: true, centreId: true },
  });
  if (users.length !== unique.length) {
    throw new BookingError("EXAMINER_NOT_FOUND", "One of the chosen examiners doesn't exist or is inactive.", 404);
  }
  if (users.some((u) => u.role !== "EXAMINER")) {
    throw new BookingError("INVALID_EXAMINER_ROLE", "Only users with the Examiner role can be in an examiner pool.", 400);
  }
  if (session.role !== "SUPER_ADMIN" && users.some((u) => u.centreId && u.centreId !== centreId)) {
    throw new BookingError("EXAMINER_CROSS_CENTRE", "Every examiner in the pool must belong to this centre.", 400);
  }
  return users;
}

// Check a set of bookings against every rule; throws BookingError on the
// first rule broken, with the riders it concerns.
export async function checkBookings(
  db: Db,
  args: { centreId: string; entries: BookingEntry[]; allowSkipLevels?: boolean; ladder?: Ladder },
) {
  const { centreId, entries } = args;
  const seen = new Set<string>();
  for (const e of entries) {
    const k = `${e.riderId}:${e.level}`;
    if (seen.has(k)) throw new BookingError("DUPLICATE_ENTRY", "The same rider is listed twice for the same level.", 400);
    seen.add(k);
  }
  const riderIds = Array.from(new Set(entries.map((e) => e.riderId)));
  const riders = await db.rider.findMany({
    where: { id: { in: riderIds }, centreId },
    select: { id: true, firstName: true, lastName: true, status: true, currentLevel: true },
  });
  if (riders.length !== riderIds.length) {
    throw new BookingError("RIDER_SCOPE_MISMATCH", "Some riders don't belong to this centre.", 400);
  }
  const byId = new Map(riders.map((r) => [r.id, r]));
  const name = (id: string) => `${byId.get(id)!.firstName} ${byId.get(id)!.lastName}`;

  const blocked = riders
    .map((r) => ({ riderId: r.id, name: `${r.firstName} ${r.lastName}`, status: r.status, reason: bookingBlockReason(r.status) }))
    .filter((r) => r.reason);
  if (blocked.length > 0) {
    const consent = blocked.filter((b) => b.status === "pending_consent").length;
    throw new BookingError(
      "RIDER_NOT_BOOKABLE",
      `${blocked.length} rider${blocked.length === 1 ? " isn't" : "s aren't"} enrolled yet and can't sit an exam: ${nameList(blocked.map((b) => b.name))}.` +
        (consent > 0 ? ` ${consent} ${consent === 1 ? "is" : "are"} waiting for parental consent — send the consent link from Riders → Consent.` : ""),
      409,
      { riders: blocked },
    );
  }

  const levels = Array.from(new Set(entries.map((e) => e.level)));
  const open = await db.exam.findMany({
    where: { riderId: { in: riderIds }, level: { in: levels }, status: { in: OPEN_EXAM_STATUSES } },
    select: { riderId: true, level: true, date: true },
    orderBy: { date: "asc" },
  });
  const clash = open.filter((o) => seen.has(`${o.riderId}:${o.level}`));
  if (clash.length > 0) {
    throw new BookingError(
      "RIDER_ALREADY_SCHEDULED",
      `Already booked: ${nameList(clash.map((c) => `${name(c.riderId)} (Level ${c.level}, ${c.date.toISOString().slice(0, 10)})`))}. Leave them out, or remove them from that sitting first.`,
      409,
      { riderIds: Array.from(new Set(clash.map((c) => c.riderId))) },
    );
  }

  const ladder = args.ladder ?? (await levelLadder(db, centreId));
  const missing = levels.filter((l) => !ladder.byRank.has(l));
  if (missing.length > 0) {
    throw new BookingError(
      "NO_TEMPLATE_FOR_LEVEL",
      `There's no scoring rubric for Level ${missing.join(", ")} at this centre.`,
      400,
    );
  }

  // Level order: a rider sits the next level up (or re-sits one they hold).
  // Nothing stopped a rider with no level being booked straight into Level 4.
  const skipped = entries
    .map((e) => {
      const r = byId.get(e.riderId)!;
      const rank = riderRank(ladder, r.currentLevel);
      return rank !== null && e.level > rank + 1
        ? { riderId: e.riderId, name: name(e.riderId), level: e.level, current: r.currentLevel ?? "no level yet" }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (skipped.length > 0 && !args.allowSkipLevels) {
    throw new BookingError(
      "LEVEL_SKIP",
      `${skipped.length} rider${skipped.length === 1 ? " would" : "s would"} skip a level: ${nameList(skipped.map((s) => `${s.name} → Level ${s.level} (now ${s.current})`))}. Confirm to book them anyway, e.g. an experienced rider joining from another club.`,
      409,
      { riders: skipped },
    );
  }

  // Re-attempt linking — each rider's most recent failed exam at that level.
  const fails = await db.exam.findMany({
    where: { riderId: { in: riderIds }, level: { in: levels }, status: "completed", passed: false },
    orderBy: { date: "desc" },
    select: { id: true, riderId: true, level: true, attemptNumber: true },
  });
  const priorFails = new Map<string, { id: string; attemptNumber: number }>();
  for (const f of fails) {
    const k = `${f.riderId}:${f.level}`;
    if (!priorFails.has(k)) priorFails.set(k, { id: f.id, attemptNumber: f.attemptNumber });
  }
  return { ladder, priorFails, skipped };
}

// Create one sitting (pool + one unassigned exam per rider) inside a
// transaction. Every exam is pinned to the rubric it will be marked against.
export async function createSittingTx(
  tx: Prisma.TransactionClient,
  args: {
    centreId: string;
    level: number;
    date: Date;
    time: string;
    notes?: string | null;
    examDayId?: string | null;
    pool: { id: string; name: string }[];
    riderIds: string[];
    rubric: Prisma.JsonValue;
    priorFails: Map<string, { id: string; attemptNumber: number }>;
  },
) {
  const sitting = await tx.examSitting.create({
    data: {
      centreId: args.centreId,
      level: args.level,
      date: args.date,
      notes: args.notes ?? null,
      examDayId: args.examDayId ?? null,
    },
  });
  await tx.examSittingExaminer.createMany({
    data: args.pool.map((u) => ({ sittingId: sitting.id, examinerId: u.id, examinerName: u.name })),
  });
  await tx.exam.createMany({
    data: args.riderIds.map((riderId) => {
      const prior = args.priorFails.get(`${riderId}:${args.level}`);
      return {
        centreId: args.centreId,
        riderId,
        examinerId: null,
        examinerName: null,
        level: args.level,
        date: args.date,
        time: args.time,
        status: "scheduled",
        sittingId: sitting.id,
        rubricSnapshotJson: args.rubric as Prisma.InputJsonValue,
        previousExamId: prior?.id ?? null,
        attemptNumber: prior ? prior.attemptNumber + 1 : 1,
      };
    }),
  });
  return sitting.id;
}
