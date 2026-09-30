import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// POST — the rider has arrived at the gate (or undo). Once a sitting uses
// check-in, "Pick next rider" only offers riders who are here, so a judge is
// never handed a child still in the car park.
const schema = z.object({ arrived: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, status: true, sitting: { select: { examiners: { select: { examinerId: true } } } } },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  const inPool = !!exam.sitting?.examiners.some((x) => x.examinerId === session.userId);
  if (!can(session.role, "exam.schedule") && !(session.role === "EXAMINER" && inPool)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (exam.status === "absent" && parsed.data.arrived) {
    return NextResponse.json({ error: "RIDER_ABSENT", message: "This rider is marked absent — undo that first." }, { status: 409 });
  }
  await prisma.exam.update({ where: { id: exam.id }, data: { checkedInAt: parsed.data.arrived ? new Date() : null } });
  return NextResponse.json({ ok: true, arrived: parsed.data.arrived });
}
