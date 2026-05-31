import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createBatchSchema } from "@/lib/schemas/batch";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  // HQ roles (SUPER_ADMIN, ADMIN) have no session.centreId — they pick a
  // centre via the topbar and the page sends it in the body. Previously
  // this guard let only SUPER_ADMIN through, so ADMIN couldn't create a
  // batch in any centre. Same isHQ pattern the rest of the codebase uses.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!session.centreId && !isHQ) {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) {
    return NextResponse.json(
      { error: "NO_CENTRE_PICKED", message: "Pick a centre from the topbar before creating a batch." },
      { status: 400 },
    );
  }

  if (d.coachId) {
    const coach = await prisma.user.findUnique({ where: { id: d.coachId } });
    if (!coach || coach.role !== "COACH" || coach.centreId !== centreId) {
      return NextResponse.json({ error: "INVALID_COACH" }, { status: 400 });
    }
  }

  const batch = await prisma.batch.create({
    data: {
      centreId,
      name: d.name,
      dayOfWeek: d.dayOfWeek,
      startTime: d.startTime,
      endTime: d.endTime,
      level: d.level || null,
      coachId: d.coachId || null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "batch",
    rowId: batch.id,
    after: batch,
  });

  return NextResponse.json({ id: batch.id });
}
