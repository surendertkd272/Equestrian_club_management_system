import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { parseRubric } from "@/lib/schemas/exam";

// POST — download a judge's riders for marking with no signal.
//
// A judge's marks already survived a dropped connection, but opening the next
// rider's card needed one — no good in an arena without coverage. While still
// online, a pool examiner takes their next riders (claimed to them, as "Pick
// next" would) and gets each card's rubric; a panel judge gets every card still
// open for them. The offline page then marks from this pack and sends the
// cards when the signal is back.
const schema = z.object({ take: z.number().int().min(0).max(20).default(5) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, level: true, groupNo: true, panelJudgeIds: true, examiners: { select: { examinerId: true, examinerName: true } } },
  });
  if (!sitting) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const me = sitting.examiners.find((x) => x.examinerId === session.userId);
  const onPanel = sitting.panelJudgeIds.includes(session.userId);
  if (!me && !onPanel) return NextResponse.json({ error: "NOT_IN_POOL" }, { status: 403 });

  let claimed = 0;
  if (me && parsed.data.take > 0) {
    const usesCheckIn = (await prisma.exam.count({ where: { sittingId: sitting.id, checkedInAt: { not: null } } })) > 0;
    const next = await prisma.exam.findMany({
      where: { sittingId: sitting.id, examinerId: null, status: "scheduled", ...(usesCheckIn ? { checkedInAt: { not: null } } : {}) },
      orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }, { rider: { firstName: "asc" } }],
      select: { id: true },
      take: parsed.data.take,
    });
    for (const e of next) {
      const r = await prisma.exam.updateMany({
        where: { id: e.id, examinerId: null, status: "scheduled" },
        data: { examinerId: me.examinerId, examinerName: me.examinerName, status: "in_progress" },
      });
      claimed += r.count;
    }
  }
  const [lead, judged, template] = await Promise.all([
    me
      ? prisma.exam.findMany({
          where: { sittingId: sitting.id, examinerId: session.userId, status: "in_progress", leadSubmittedAt: null },
          orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }],
          select: { id: true, runOrder: true, time: true, scoresJson: true, rubricSnapshotJson: true, rider: { select: { firstName: true, lastName: true } } },
        })
      : [],
    onPanel
      ? prisma.examJudge.findMany({
          where: { judgeId: session.userId, submittedAt: null, exam: { sittingId: sitting.id, status: { in: ["scheduled", "in_progress"] } } },
          select: {
            scoresJson: true,
            exam: { select: { id: true, runOrder: true, time: true, rubricSnapshotJson: true, rider: { select: { firstName: true, lastName: true } } } },
          },
        })
      : [],
    prisma.scoringTemplate.findUnique({
      where: { centreId_levelKey: { centreId: sitting.centreId, levelKey: String(sitting.level) } },
      select: { levelName: true, passThreshold: true, categoriesJson: true },
    }),
  ]);
  const rubricOf = (snap: unknown) => parseRubric(snap ?? template?.categoriesJson ?? []);
  const cards = [
    ...lead.map((e) => ({
      examId: e.id, card: "lead" as const, judgeId: null, order: e.runOrder, time: e.time,
      rider: `${e.rider.firstName} ${e.rider.lastName}`, rubric: rubricOf(e.rubricSnapshotJson),
      scores: (e.scoresJson && typeof e.scoresJson === "object" ? e.scoresJson : {}) as Record<string, number | string>,
    })),
    ...judged.map((j) => ({
      examId: j.exam.id, card: "judge" as const, judgeId: session.userId, order: j.exam.runOrder, time: j.exam.time,
      rider: `${j.exam.rider.firstName} ${j.exam.rider.lastName}`, rubric: rubricOf(j.exam.rubricSnapshotJson),
      scores: (j.scoresJson && typeof j.scoresJson === "object" ? j.scoresJson : {}) as Record<string, number | string>,
    })),
  ].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  if (claimed) {
    await audit({ userId: session.userId, action: "exam.offline_pack", tableName: "examSitting", rowId: sitting.id, after: { claimed } });
  }
  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    sitting: { id: sitting.id, title: `${template?.levelName ?? `Level ${sitting.level}`}${sitting.groupNo ? ` · Group ${sitting.groupNo}` : ""}`, passThreshold: template?.passThreshold ?? null },
    claimed,
    cards,
  });
}
