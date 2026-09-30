import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";

// POST — a pool examiner picks the next rider in the running order (or the
// next by name when there's no order). One tap on a phone instead of
// scrolling a 120-row queue. Same first-come lock as picking a rider by hand.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, examiners: { select: { examinerId: true, examinerName: true } } },
  });
  if (!sitting) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const me = sitting.examiners.find((x) => x.examinerId === session.userId);
  if (!me) return NextResponse.json({ error: "NOT_IN_POOL" }, { status: 403 });

  // Once the gate is checking riders in, only riders who are here are offered.
  const usesCheckIn = (await prisma.exam.count({ where: { sittingId: sitting.id, checkedInAt: { not: null } } })) > 0;
  // Another examiner may take the same rider a moment earlier; try the next.
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = await prisma.exam.findFirst({
      where: { sittingId: sitting.id, examinerId: null, status: "scheduled", ...(usesCheckIn ? { checkedInAt: { not: null } } : {}) },
      orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }, { time: "asc" }, { rider: { firstName: "asc" } }],
      select: { id: true },
    });
    if (!next) {
      return NextResponse.json(
        {
          error: "QUEUE_EMPTY",
          message: usesCheckIn ? "No checked-in rider is waiting — check the gate list." : "Nobody is left waiting in this sitting.",
        },
        { status: 409 },
      );
    }
    const res = await prisma.exam.updateMany({
      where: { id: next.id, examinerId: null, status: "scheduled" },
      data: { examinerId: me.examinerId, examinerName: me.examinerName, status: "in_progress" },
    });
    if (res.count === 1) {
      await audit({ userId: session.userId, action: "exam.claimed", tableName: "exam", rowId: next.id, after: { examinerId: me.examinerId, via: "next" } });
      return NextResponse.json({ ok: true, id: next.id });
    }
  }
  return NextResponse.json({ error: "BUSY", message: "Other examiners are picking riders right now — try again." }, { status: 409 });
}
