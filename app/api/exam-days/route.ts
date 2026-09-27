import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import {
  BookingError,
  MAX_EXAMINERS_PER_POOL,
  MAX_RIDERS_PER_DAY,
  MAX_RIDERS_PER_SITTING,
  checkBookings,
  createSittingTx,
  examinerPool,
} from "@/lib/exam-booking";

// Book a whole exam day in one go: riders across several levels on one date.
// Creates the ExamDay plus one ordinary sitting per level (each with its own
// examiner pool), all in one transaction. A 200-rider day used to mean five
// separate sittings with nothing tying them together.
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  notes: z.string().max(500).optional(),
  entries: z
    .array(z.object({ riderId: z.string().min(1), level: z.coerce.number().int().min(1).max(10) }))
    .min(1)
    .max(MAX_RIDERS_PER_DAY),
  // Examiner pool per level, keyed by level number.
  pools: z.record(z.array(z.string().min(1)).min(1).max(MAX_EXAMINERS_PER_POOL)),
  allowSkipLevels: z.boolean().optional(),
  centreId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const block = await blockIfReadOnly(session);
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const centre = await resolveWriteCentre(session, body);
  if (centre.error) return centre.error;
  const { centreId } = centre;

  try {
    const byLevel = new Map<number, string[]>();
    for (const e of d.entries) byLevel.set(e.level, [...(byLevel.get(e.level) ?? []), e.riderId]);
    for (const [level, riders] of byLevel) {
      if (riders.length > MAX_RIDERS_PER_SITTING) {
        throw new BookingError("TOO_MANY_RIDERS", `Level ${level} has ${riders.length} riders — the most for one level is ${MAX_RIDERS_PER_SITTING}.`, 400);
      }
      if (!d.pools[String(level)]?.length) {
        throw new BookingError("POOL_REQUIRED", `Pick at least one examiner for Level ${level}.`, 400);
      }
    }
    const pools = new Map<number, Awaited<ReturnType<typeof examinerPool>>>();
    for (const level of byLevel.keys()) {
      pools.set(level, await examinerPool(prisma, session, centreId, d.pools[String(level)], parseDateOnly(d.date)));
    }
    const { ladder, priorFails, skipped } = await checkBookings(prisma, {
      centreId,
      entries: d.entries,
      allowSkipLevels: d.allowSkipLevels,
    });
    const date = parseDateOnly(d.date);
    const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

    const result = await prisma.$transaction(async (tx) => {
      const day = await tx.examDay.create({
        data: { centreId, name: d.name, date, time: d.time, notes: d.notes ?? null, createdBy: session.userId },
      });
      const sittings: { level: number; id: string; riders: number }[] = [];
      for (const level of levels) {
        const riderIds = byLevel.get(level)!;
        const id = await createSittingTx(tx, {
          centreId,
          level,
          date,
          time: d.time,
          notes: d.notes ?? null,
          examDayId: day.id,
          pool: pools.get(level)!,
          riderIds,
          rubric: ladder.byRank.get(level)!.categoriesJson,
          priorFails,
        });
        sittings.push({ level, id, riders: riderIds.length });
      }
      return { id: day.id, sittings };
    });

    await audit({
      userId: session.userId,
      action: "exam.day_created",
      tableName: "examDay",
      rowId: result.id,
      after: {
        name: d.name,
        date: d.date,
        time: d.time,
        riders: d.entries.length,
        sittings: result.sittings,
        ...(skipped.length ? { skippedLevels: skipped } : {}),
      },
    });
    return NextResponse.json({ id: result.id, sittings: result.sittings, examsCreated: d.entries.length });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
    }
    throw e;
  }
}
