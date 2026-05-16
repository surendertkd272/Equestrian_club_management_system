import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateSkillStatusSchema } from "@/lib/schemas/progress";
import { audit } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; skillId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "progress.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSkillStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Validate the skill exists for this centre.
  const skill = await prisma.skill.findUnique({
    where: { id: params.skillId },
    select: { id: true, name: true, level: { select: { centreId: true } } },
  });
  if (!skill || skill.level.centreId !== rider.centreId) {
    return NextResponse.json({ error: "SKILL_NOT_FOUND" }, { status: 404 });
  }

  const prior = await prisma.riderSkillStatus.findUnique({
    where: { riderId_skillId: { riderId: rider.id, skillId: skill.id } },
  });

  const row = await prisma.riderSkillStatus.upsert({
    where: { riderId_skillId: { riderId: rider.id, skillId: skill.id } },
    create: {
      riderId: rider.id,
      skillId: skill.id,
      status: parsed.data.status,
      coachNotes: parsed.data.coachNotes ?? null,
    },
    update: {
      status: parsed.data.status,
      coachNotes: parsed.data.coachNotes ?? prior?.coachNotes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "progress.update",
    tableName: "riderSkillStatus",
    rowId: `${rider.id}:${skill.id}`,
    before: prior ? { status: prior.status } : null,
    after: { status: row.status, skill: skill.name },
  });

  return NextResponse.json({ ok: true, status: row.status });
}
