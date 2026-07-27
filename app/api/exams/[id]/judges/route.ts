import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { formatEnum } from "@/lib/labels";

const addSchema = z.object({ judgeId: z.string().min(1) });

// Roles that may be seated on an exam jury. Examiners are the point of the
// role; senior coaching staff and centre management routinely co-judge at
// club level. Everyone else — grooms, farriers, vets, accountants, inventory,
// school observers, inspection officers, riders, parents — must not appear on
// a jury panel, because that panel is printed on the result sheet.
const JUDGE_ELIGIBLE_ROLES: readonly string[] = [
  "EXAMINER",
  "HEAD_COACH",
  "COACH",
  "CENTRE_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
];

// POST — add a co-judge to an exam. Position auto-assigned as max+1, so the
// lead examiner stays implicit at position 1 (no row needed for them).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { judges: { orderBy: { position: "desc" }, take: 1 } },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence36 = await centreFence(session, exam.centreId);
  if (fence36) {
    return NextResponse.json({ error: fence36 }, { status: 403 });
  }
  if (exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }
  if (exam.examinerId === parsed.data.judgeId) {
    return NextResponse.json({ error: "ALREADY_LEAD" }, { status: 409 });
  }

  const judge = await prisma.user.findUnique({
    where: { id: parsed.data.judgeId },
    select: { id: true, name: true, role: true, centreId: true, status: true },
  });
  if (!judge || judge.status !== "active") return NextResponse.json({ error: "INVALID_JUDGE" }, { status: 400 });
  // Only people who could plausibly assess a ride. The route checked the
  // CALLER's role but never the judge's, so any active staff member could be
  // seated on the jury — a stable groom was accepted and printed on the panel
  // as an official judge, on a card that decides a child's promotion.
  if (!JUDGE_ELIGIBLE_ROLES.includes(judge.role)) {
    return NextResponse.json(
      {
        error: "JUDGE_NOT_ELIGIBLE",
        message: `${judge.name} (${formatEnum(judge.role)}) can't sit on an exam jury. Pick an examiner, coach, head coach or centre manager.`,
      },
      { status: 400 },
    );
  }
  // Co-judge has to share the tenant context unless SUPER_ADMIN is staffing
  // a cross-centre meet.
  if (judge.centreId && judge.centreId !== exam.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "JUDGE_CROSS_CENTRE" }, { status: 400 });
  }

  try {
    const nextPos = (exam.judges[0]?.position ?? 1) + 1;
    const row = await prisma.examJudge.create({
      data: {
        examId: exam.id,
        judgeId: judge.id,
        judgeName: judge.name,
        position: nextPos,
      },
    });
    await audit({
      userId: session.userId,
      action: "exam.judge_added",
      tableName: "examJudge",
      rowId: row.id,
      after: { examId: exam.id, judgeId: judge.id, position: nextPos },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_JUDGE" }, { status: 409 });
    throw e;
  }
}
