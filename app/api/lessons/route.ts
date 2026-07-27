import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createLessonSchema } from "@/lib/schemas/lesson";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { startOfDayInTz, endOfDayInTz, parseWallTimeInTz } from "@/lib/tz";

// GET /api/lessons?date=YYYY-MM-DD — lessons for that calendar day,
// scoped to the caller's centre (SUPER_ADMIN can pass ?centreId=).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const dateStr = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const centreId = isHQ
    ? url.searchParams.get("centreId") ?? session.centreId
    : session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  // An HQ caller supplies that centre id in the query string. Without a fence
  // it is simply believed, so one tenant's admin could read another tenant's
  // timetable by pasting a centre id.
  const getFence = await centreFence(session, centreId);
  if (getFence) return NextResponse.json({ error: getFence }, { status: 403 });

  // Bucket by the CENTRE's local day, not the server's (UTC) — otherwise a
  // lesson late in the local evening lands on the wrong day near midnight IST.
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
  const tz = centre?.timezone ?? "Asia/Kolkata";
  const ref = new Date(`${safeDate}T12:00:00Z`); // noon UTC anchors the right calendar date for IST-like zones
  const dayStart = startOfDayInTz(ref, tz);
  const dayEnd = endOfDayInTz(ref, tz);

  const lessons = await prisma.lesson.findMany({
    where: { centreId, date: { gte: dayStart, lte: dayEnd } },
    orderBy: { date: "asc" },
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

  return NextResponse.json({ lessons });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "lesson.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createLessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // HQ roles can target any centre via the request body; centre-scoped
  // roles (including COACH) always act on their own session.centreId.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const centreId = isHQ ? (d.centreId ?? session.centreId) : session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  // Same for the write: the body's centreId is client-supplied.
  const postFence = await centreFence(session, centreId);
  if (postFence) return NextResponse.json({ error: postFence }, { status: 403 });

  // Batch (if any) must belong to this centre — defends against
  // SUPER_ADMINs grabbing a centreId that doesn't match their batch.
  if (d.batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: d.batchId } });
    if (!batch || batch.centreId !== centreId) {
      return NextResponse.json({ error: "INVALID_BATCH" }, { status: 400 });
    }
  }

  // The form sends the picked wall-clock time ("YYYY-MM-DDTHH:MM"); interpret it
  // in the CENTRE's zone, not the server's (UTC on Vercel) or the admin's
  // browser. Otherwise an HQ admin in another zone — or the UTC server — would
  // store the wrong instant, and "6 AM" would come back as 11:30 AM / 12:30 AM.
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
  const tz = centre?.timezone ?? "Asia/Kolkata";

  const lesson = await prisma.lesson.create({
    data: {
      centreId,
      batchId: d.batchId ?? null,
      date: parseWallTimeInTz(d.date, tz),
      endAt: parseWallTimeInTz(d.endAt, tz),
      coachId: d.coachId ?? null,
      notes: d.notes ?? null,
      createdBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "lesson",
    rowId: lesson.id,
    after: { batchId: lesson.batchId, date: lesson.date, coachId: lesson.coachId },
  });

  return NextResponse.json({ id: lesson.id });
}
