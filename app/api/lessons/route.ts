import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createLessonSchema } from "@/lib/schemas/lesson";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { startOfDayInTz, endOfDayInTz } from "@/lib/tz";

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

  // Batch (if any) must belong to this centre — defends against
  // SUPER_ADMINs grabbing a centreId that doesn't match their batch.
  if (d.batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: d.batchId } });
    if (!batch || batch.centreId !== centreId) {
      return NextResponse.json({ error: "INVALID_BATCH" }, { status: 400 });
    }
  }

  const lesson = await prisma.lesson.create({
    data: {
      centreId,
      batchId: d.batchId ?? null,
      date: new Date(d.date),
      endAt: new Date(d.endAt),
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
