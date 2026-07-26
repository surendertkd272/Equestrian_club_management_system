import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateLessonSchema } from "@/lib/schemas/lesson";
import { audit } from "@/lib/audit";
import { notifyRiderAndParents } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { AllocConflict } from "@/lib/allocation-guard";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { parseWallTimeInTz, startOfDayInTz, endOfDayInTz, sameLocalDay, wallPartsInTz } from "@/lib/tz";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const lesson = await prisma.lesson.findUnique({
    where: { id: params.id },
    include: {
      batch: { select: { id: true, name: true, level: true } },
      allocations: {
        include: {
          rider: { select: { id: true, firstName: true, lastName: true } },
          horse: { select: { id: true, name: true, stableNo: true } },
        },
      },
    },
  });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json({ lesson });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "lesson.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({
    where: { id: params.id },
    // riderId comes along so a cancellation/reschedule can notify the families
    // whose children were actually booked into this session.
    include: { centre: { select: { timezone: true } }, allocations: { select: { horseId: true, riderId: true } } },
  });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  const tz = lesson.centre.timezone;

  const body = await req.json().catch(() => null);
  const parsed = updateLessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Date/endAt arrive as a zoneless wall-clock string; interpret in the centre's
  // zone (server is UTC on Vercel). Cross-field date sanity: the create schema
  // refines endAt > date, but this PATCH applies each field independently, so a
  // one-sided edit (move endAt before the stored date, or date past the stored
  // endAt) would invert the window. Merge incoming over stored and re-check
  // (same fix as events, #133).
  const effDate = d.date !== undefined ? parseWallTimeInTz(d.date, tz) : lesson.date;
  const effEnd = d.endAt !== undefined ? parseWallTimeInTz(d.endAt, tz) : lesson.endAt;
  if (effEnd && !(effEnd > effDate)) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE", message: "endAt must be after the lesson start" }, { status: 400 });
  }

  // Moving a lesson's time must move its allocations with it. HorseAllocation
  // rows snapshot the lesson window (startAt/endAt) at allocation time, and the
  // double-booking overlap guard + daily-cap bucketing read those columns — so
  // if we changed only the Lesson row, those rows would keep the OLD window and
  // silently let the horse be double-booked / mis-count its daily minutes.
  const timeChanged =
    (d.date !== undefined && effDate.getTime() !== lesson.date.getTime()) ||
    (d.endAt !== undefined && effEnd.getTime() !== lesson.endAt.getTime());
  const horseIds = Array.from(new Set(lesson.allocations.map((a) => a.horseId)));
  const willCancel = d.status === "cancelled" && lesson.status !== "cancelled";
  const willSyncAllocs = timeChanged && !willCancel && horseIds.length > 0;

  // The daily cap buckets by start-day, so a window that spans >1 local day
  // can't be reconciled — reject (mirrors the allocations route's guard).
  if (willSyncAllocs && !sameLocalDay(effDate, new Date(effEnd.getTime() - 1), tz)) {
    return NextResponse.json(
      { error: "MULTI_DAY_LESSON", message: "New window spans more than one day; a lesson with riders must be a single-day session." },
      { status: 400 },
    );
  }
  // Horse names for any conflict message (ids alone aren't useful to the admin).
  const horseNames = willSyncAllocs
    ? new Map((await prisma.horse.findMany({ where: { id: { in: horseIds } }, select: { id: true, name: true } })).map((h) => [h.id, h.name]))
    : new Map<string, string>();

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.lesson.update({
        where: { id: lesson.id },
        data: {
          ...(d.date !== undefined ? { date: effDate } : {}),
          ...(d.endAt !== undefined ? { endAt: effEnd } : {}),
          ...(d.coachId !== undefined ? { coachId: d.coachId } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
          ...(d.rescheduledToId !== undefined ? { rescheduledToId: d.rescheduledToId } : {}),
        },
      });

      if (willCancel) {
        // Cancelling releases the horses — otherwise the rows linger and keep
        // blocking those horses (overlap) + consuming their daily cap.
        await tx.horseAllocation.deleteMany({ where: { lessonId: lesson.id } });
      } else if (willSyncAllocs) {
        // Lock the horses, re-check the cross-lesson clash + daily cap against
        // the NEW window (excluding this lesson's own rows), then move this
        // lesson's rows to it — all atomic so a concurrent save can't slip a
        // double-booking through the gap.
        await tx.$queryRaw`SELECT id FROM "Horse" WHERE id IN (${Prisma.join(horseIds)}) ORDER BY id FOR UPDATE`;

        const clashes = await tx.horseAllocation.findMany({
          where: { horseId: { in: horseIds }, lessonId: { not: lesson.id }, startAt: { lt: effEnd }, endAt: { gt: effDate } },
          select: { horseId: true },
        });
        if (clashes.length > 0) {
          const names = Array.from(new Set(clashes.map((c) => horseNames.get(c.horseId) ?? c.horseId)));
          throw new AllocConflict("HORSE_DOUBLE_BOOKED", `Already booked in an overlapping window: ${names.join(", ")}.`);
        }

        const dayStart = startOfDayInTz(effDate, tz);
        const dayEnd = endOfDayInTz(effDate, tz);
        const lessonMin = (effEnd.getTime() - effDate.getTime()) / 60000;
        const others = await tx.horseAllocation.findMany({
          where: { horseId: { in: horseIds }, lessonId: { not: lesson.id }, startAt: { gte: dayStart, lte: dayEnd } },
          select: { horseId: true, startAt: true, endAt: true },
        });
        const usedByHorse = new Map<string, number>();
        for (const a of others) {
          usedByHorse.set(a.horseId, (usedByHorse.get(a.horseId) ?? 0) + (a.endAt.getTime() - a.startAt.getTime()) / 60000);
        }
        const over = horseIds.filter((id) => (usedByHorse.get(id) ?? 0) + lessonMin > DEFAULT_WORKLOAD_CAP_MIN);
        if (over.length > 0) {
          const names = over.map((id) => horseNames.get(id) ?? id);
          throw new AllocConflict("WORKLOAD_EXCEEDED", `Would exceed the daily ${DEFAULT_WORKLOAD_CAP_MIN}-minute work cap: ${names.join(", ")}.`);
        }

        await tx.horseAllocation.updateMany({ where: { lessonId: lesson.id }, data: { startAt: effDate, endAt: effEnd } });
      }
      return u;
    });

    await audit({
      userId: session.userId,
      action: "update",
      tableName: "lesson",
      rowId: updated.id,
      before: { status: lesson.status, date: lesson.date },
      after: { status: updated.status, date: updated.date },
    });

    // Tell the families. A cancelled or moved lesson previously notified nobody
    // — the allocation was released cleanly and the riders' parents still drove
    // to the centre. The riders to tell are the ones who had a horse allocated
    // to this session; a lesson with no allocations has no one to warn.
    const riderIds = Array.from(new Set(lesson.allocations.map((a) => a.riderId).filter(Boolean))) as string[];
    if (riderIds.length > 0 && (willCancel || timeChanged)) {
      const w = wallPartsInTz(lesson.date, tz);
      const when = `${w.date} ${w.time}`;
      for (const riderId of riderIds) {
        await notifyRiderAndParents(riderId, {
          type: willCancel ? "lesson.cancelled" : "lesson.rescheduled",
          title: willCancel ? `Lesson cancelled — ${when}` : `Lesson moved — was ${when}`,
          body: willCancel
            ? `The session on ${when} has been cancelled${d.notes ? `: ${d.notes}` : "."} Please contact the centre if you need a make-up.`
            : (() => { const n = wallPartsInTz(effDate, tz); return `That session now starts ${n.date} ${n.time}.`; })(),
          link: `/parent`,
          criticality: "critical",
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AllocConflict) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // lesson.write — granted to COACH + HEAD_COACH + CENTRE_MANAGER + ADMIN
  // + SUPER_ADMIN. Coaches need this to clean up wrongly-scheduled
  // sessions for their own batches. Cross-centre is still blocked below.
  if (!can(session.role, "lesson.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // isHQ matches the canonical pattern used elsewhere — ADMIN deserves the
  // same cross-centre bypass that SUPER_ADMIN has.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  // Delete the lesson's HorseAllocation rows too. The FK is onDelete: SetNull,
  // so without this the rows would survive with lessonId=null and keep blocking
  // their horses (overlap) + consuming the daily cap — orphaned ghost bookings.
  await prisma.$transaction([
    prisma.horseAllocation.deleteMany({ where: { lessonId: lesson.id } }),
    prisma.lesson.delete({ where: { id: lesson.id } }),
  ]);
  await audit({ userId: session.userId, action: "delete", tableName: "lesson", rowId: lesson.id });
  return NextResponse.json({ ok: true });
}
