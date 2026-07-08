import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { addMemberSchema } from "@/lib/schemas/teams";

// POST /api/teams/[id]/members — add a rider. Unique on (teamId, riderId)
// so repeat-adds become no-ops (re-fetches the existing row).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "team.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return NextResponse.json({ error: "TEAM_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && team.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  const rider = await prisma.rider.findUnique({
    where: { id: parsed.data.riderId },
    select: { centreId: true },
  });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  if (rider.centreId !== team.centreId) {
    return NextResponse.json({ error: "RIDER_CROSS_CENTRE" }, { status: 400 });
  }

  const row = await prisma.teamMember.upsert({
    where: { teamId_riderId: { teamId: team.id, riderId: parsed.data.riderId } },
    create: {
      teamId: team.id,
      riderId: parsed.data.riderId,
      position: parsed.data.position ?? null,
    },
    update: { position: parsed.data.position ?? null },
  });
  await audit({
    userId: session.userId,
    action: "team.member_add",
    tableName: "teamMember",
    rowId: row.id,
    after: { teamId: team.id, riderId: parsed.data.riderId },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

// DELETE /api/teams/[id]/members?riderId=...
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "team.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const url = new URL(req.url);
  const riderId = url.searchParams.get("riderId");
  if (!riderId) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return NextResponse.json({ error: "TEAM_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && team.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  await prisma.teamMember.deleteMany({ where: { teamId: team.id, riderId } });
  return NextResponse.json({ ok: true });
}
