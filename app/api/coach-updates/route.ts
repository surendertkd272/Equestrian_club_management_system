// Coach's daily 5-minute update. Upserts one row per (centre, coach, date)
// so re-saving the same day edits in place rather than duplicating.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { coachUpdateSchema } from "@/lib/schemas/coach-update";

const CAN_LOG = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
]);

function dateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_LOG.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = session.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = coachUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const row = await prisma.coachDailyUpdate.upsert({
    where: {
      centreId_coachUserId_date: {
        centreId,
        coachUserId: session.userId,
        date: dateOnly(d.date),
      },
    },
    create: {
      centreId,
      coachUserId: session.userId,
      date: dateOnly(d.date),
      summary: d.summary,
      horsesWorked: d.horsesWorked ?? null,
      ridersTaught: d.ridersTaught ?? null,
      injuriesNoted: d.injuriesNoted ?? null,
      minutesSpent: d.minutesSpent ?? null,
    },
    update: {
      summary: d.summary,
      horsesWorked: d.horsesWorked ?? null,
      ridersTaught: d.ridersTaught ?? null,
      injuriesNoted: d.injuriesNoted ?? null,
      minutesSpent: d.minutesSpent ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "coach_update.save",
    tableName: "coachDailyUpdate",
    rowId: row.id,
    after: { date: d.date, horsesWorked: d.horsesWorked ?? null, hasInjuries: !!d.injuriesNoted },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
