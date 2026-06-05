import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createTeamSchema } from "@/lib/schemas/teams";

// GET — list active teams + member counts.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  const where: Prisma.TeamWhereInput = {};
  if (session.role !== "SUPER_ADMIN" && session.centreId) where.centreId = session.centreId;

  const rows = await prisma.team.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ rows });
}

// POST — create a team.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });

  const row = await prisma.team.create({
    data: {
      centreId,
      name: parsed.data.name,
      season: parsed.data.season ?? null,
      discipline: parsed.data.discipline ?? null,
      captainId: parsed.data.captainId ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  await audit({
    userId: session.userId,
    action: "team.create",
    tableName: "team",
    rowId: row.id,
    after: { name: row.name, season: row.season },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
