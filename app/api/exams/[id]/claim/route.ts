// Claim (pick) a rider from a sitting's pool to mark them. First-come: the
// claim atomically assigns the exam to the examiner and locks scoring to them
// (only an examiner in the sitting's pool may claim, and only while unassigned).
// A manager/admin may reassign an already-claimed exam (override).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({ examinerId: z.string().min(1).optional() });

const MANAGER_ROLES = new Set(["SUPER_ADMIN", "CENTRE_MANAGER"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { sitting: { include: { examiners: true } } },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (!exam.sitting) {
    return NextResponse.json({ error: "NOT_A_SITTING_EXAM" }, { status: 400 });
  }
  if (exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  const pool = exam.sitting.examiners;
  const isManager = MANAGER_ROLES.has(session.role);

  // Reassign/override path — a manager hands the exam to a chosen pool examiner
  // (allowed even if already claimed).
  if (parsed.data.examinerId) {
    if (!isManager) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const target = pool.find((p) => p.examinerId === parsed.data.examinerId);
    if (!target) return NextResponse.json({ error: "NOT_IN_POOL" }, { status: 400 });
    await prisma.exam.update({
      where: { id: exam.id },
      data: {
        examinerId: target.examinerId,
        examinerName: target.examinerName,
        status: exam.status === "scheduled" ? "in_progress" : exam.status,
      },
    });
    await audit({
      userId: session.userId,
      action: "exam.reassigned",
      tableName: "exam",
      rowId: exam.id,
      after: { examinerId: target.examinerId },
    });
    return NextResponse.json({ ok: true, id: exam.id, mode: "reassigned" });
  }

  // Self-claim path — the caller picks the rider. Must be in the pool.
  const me = pool.find((p) => p.examinerId === session.userId);
  if (!me) return NextResponse.json({ error: "NOT_IN_POOL" }, { status: 403 });

  // Atomic first-come lock: only succeeds while the exam is still unassigned.
  const res = await prisma.exam.updateMany({
    where: { id: exam.id, examinerId: null },
    data: { examinerId: me.examinerId, examinerName: me.examinerName, status: "in_progress" },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "ALREADY_CLAIMED" }, { status: 409 });
  }
  await audit({
    userId: session.userId,
    action: "exam.claimed",
    tableName: "exam",
    rowId: exam.id,
    after: { examinerId: me.examinerId },
  });
  return NextResponse.json({ ok: true, id: exam.id, mode: "claimed" });
}
