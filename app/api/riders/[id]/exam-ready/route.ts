import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { levelLadder } from "@/lib/exam-booking";

// POST — a coach says a rider is ready to sit a level (or withdraws that).
// Booking only suggested "the next level up", whether or not the rider's coach
// agreed. A nomination is advice for whoever books the exam day, shown there
// with a filter; it changes nothing on the rider's record by itself, so it is
// not routed through change approval — the manager's booking is the decision.
const COACH_ROLES = new Set(["COACH", "HEAD_COACH", "CENTRE_MANAGER", "ADMIN", "SUPER_ADMIN"]);
const schema = z.object({ level: z.number().int().min(1).max(10).nullable(), note: z.string().trim().max(300).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!COACH_ROLES.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const rider = await prisma.rider.findUnique({ where: { id: params.id }, select: { id: true, centreId: true, examReadyLevel: true } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, rider.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const { level, note } = parsed.data;
  if (level !== null && !(await levelLadder(prisma, rider.centreId)).byRank.has(level)) {
    return NextResponse.json({ error: "UNKNOWN_LEVEL", message: `There's no Level ${level} at this centre.` }, { status: 400 });
  }
  await prisma.rider.update({
    where: { id: rider.id },
    data:
      level === null
        ? { examReadyLevel: null, examReadyAt: null, examReadyBy: null, examReadyNote: null }
        : { examReadyLevel: level, examReadyAt: new Date(), examReadyBy: session.userId, examReadyNote: note || null },
  });
  await audit({
    userId: session.userId,
    action: level === null ? "rider.exam_ready_cleared" : "rider.exam_ready",
    tableName: "rider",
    rowId: rider.id,
    before: { level: rider.examReadyLevel },
    after: { level, note: note ?? null },
  });
  return NextResponse.json({ ok: true, level });
}
