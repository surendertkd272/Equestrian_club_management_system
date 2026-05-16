import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildIcs } from "@/lib/ics";

// GET /api/calendar/me.ics — current user's lesson + exam calendar.
//
// Subscribed via:
//   Google Calendar → Other calendars → From URL
//   Apple Calendar  → File → New Calendar Subscription
//   Outlook         → Add calendar → Subscribe from web
//
// Cache-Control is short so each refresh on the consuming app picks up
// new lessons within ~10 minutes. Auth: must be signed in — we don't
// expose a public token-authed variant here. (A future "secret URL"
// variant is documented in DEPLOYMENT.md; out of scope for v1.)
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("UNAUTHENTICATED", { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const horizonStart = new Date(Date.now() - 7 * 86400000); // 7d back, for context
  const horizonEnd = new Date(Date.now() + 90 * 86400000); // 90d ahead

  // We collect three kinds of events for the user:
  //   1. Lessons the user is the coach of (lessons.coachId / batch.coachId).
  //   2. Lessons the user is allocated to as a RIDER (HorseAllocation.riderId).
  //   3. Exams where the user is the rider or the examiner.
  //
  // Each event uses a stable UID so calendar apps update existing
  // entries instead of duplicating on each pull.

  type IcsEv = Parameters<typeof buildIcs>[0]["events"][number];
  const events: IcsEv[] = [];

  // 1) Coaching lessons
  const coachLessons = await prisma.lesson.findMany({
    where: {
      OR: [{ coachId: session.userId }, { batch: { coachId: session.userId } }],
      date: { gte: horizonStart, lte: horizonEnd },
    },
    include: {
      batch: { select: { name: true, level: true } },
      allocations: { select: { rider: { select: { firstName: true, lastName: true } }, horse: { select: { name: true } } } },
    },
    orderBy: { date: "asc" },
    take: 500,
  });
  for (const l of coachLessons) {
    events.push({
      uid: `lesson-${l.id}@equiwings`,
      title: `Coach · ${l.batch?.name ?? "Ad-hoc lesson"}${l.batch?.level ? ` (${l.batch.level})` : ""}`,
      start: l.date,
      end: l.endAt,
      description: l.allocations.length
        ? `Riders: ${l.allocations.map((a) => `${a.rider?.firstName} → ${a.horse.name}`).join("; ")}`
        : l.notes ?? "",
      url: `${baseUrl}/lessons/${l.id}`,
      status: l.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
    });
  }

  // 2) Allocations where the user is the rider
  const rider = await prisma.rider.findFirst({ where: { userId: session.userId }, select: { id: true } });
  if (rider) {
    const allocs = await prisma.horseAllocation.findMany({
      where: {
        riderId: rider.id,
        purpose: "lesson",
        startAt: { gte: horizonStart, lte: horizonEnd },
      },
      include: {
        horse: { select: { name: true, stableNo: true } },
        lesson: { select: { id: true, status: true, batch: { select: { name: true, level: true } } } },
      },
      orderBy: { startAt: "asc" },
      take: 500,
    });
    for (const a of allocs) {
      events.push({
        uid: `alloc-${a.id}@equiwings`,
        title: `Lesson · ride ${a.horse.name}${a.horse.stableNo ? ` (${a.horse.stableNo})` : ""}`,
        start: a.startAt,
        end: a.endAt,
        description: a.lesson?.batch?.name ?? "",
        url: a.lesson ? `${baseUrl}/lessons/${a.lesson.id}` : undefined,
        status: a.lesson?.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
      });
    }
  }

  // 3) Exams — rider or examiner. Exam.date is the day only; combine
  // with Exam.time (HH:MM 24h) to get a real start instant.
  const exams = await prisma.exam.findMany({
    where: {
      OR: [
        rider ? { riderId: rider.id } : { id: "__none__" },
        { examinerId: session.userId },
      ],
      date: { gte: horizonStart, lte: horizonEnd },
    },
    select: { id: true, level: true, date: true, time: true, status: true, examinerName: true },
    orderBy: { date: "asc" },
    take: 200,
  });
  for (const e of exams) {
    const [hh, mm] = (e.time ?? "09:00").split(":").map(Number);
    const startAt = new Date(e.date);
    startAt.setUTCHours(hh ?? 9, mm ?? 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);
    events.push({
      uid: `exam-${e.id}@equiwings`,
      title: `Exam · Level ${e.level}${e.examinerName ? ` (${e.examinerName})` : ""}`,
      start: startAt,
      end: endAt,
      description: `Status: ${e.status}`,
      url: `${baseUrl}/exams/${e.id}`,
      status: "CONFIRMED",
    });
  }

  const ics = buildIcs({
    prodId: "Equiwings",
    calName: `Equiwings · ${session.name}`,
    events,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="equiwings-${session.userId.slice(-6)}.ics"`,
      "Cache-Control": "private, max-age=600",
    },
  });
}

