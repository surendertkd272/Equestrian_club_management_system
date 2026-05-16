import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PRD — "assigning grooms for test-day support". One Exam can have several
// support staff (groom, ring crew, scribe). Stored as a JSON array of user.id
// strings on Exam.supportStaffJson; replaced wholesale on every PATCH.
const schema = z.object({
  supportStaffIds: z.array(z.string().min(1)).max(20),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "external-exams");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const exam = await prisma.exam.findUnique({ where: { id: params.id } });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Sanity-check the user IDs exist + are in the same centre.
  if (parsed.data.supportStaffIds.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: parsed.data.supportStaffIds },
        OR: [{ centreId: exam.centreId }, { role: "SUPER_ADMIN" }],
      },
      select: { id: true },
    });
    if (users.length !== parsed.data.supportStaffIds.length) {
      return NextResponse.json({ error: "BAD_USER_IDS" }, { status: 400 });
    }
  }

  await prisma.exam.update({
    where: { id: exam.id },
    data: {
      supportStaffJson:
        parsed.data.supportStaffIds.length === 0
          ? null
          : JSON.stringify(parsed.data.supportStaffIds),
    },
  });
  await audit({
    userId: session.userId,
    action: "exam.support_staff_set",
    tableName: "exam",
    rowId: exam.id,
    after: { supportStaffIds: parsed.data.supportStaffIds },
  });
  return NextResponse.json({ ok: true });
}
