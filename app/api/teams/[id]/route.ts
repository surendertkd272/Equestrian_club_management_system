// Edit / soft-delete a team / squad. Permission: competition.manage.
// DELETE is soft (active=false) so membership history is preserved.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { updateTeamSchema } from "@/lib/schemas/teams";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

async function loadOwned(id: string, session: { role: string; centreId: string | null }) {
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && team.centreId !== session.centreId) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 }) };
  }
  return { team };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "team.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { team, error } = await loadOwned(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  await prisma.team.update({
    where: { id: team!.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.season !== undefined ? { season: d.season } : {}),
      ...(d.discipline !== undefined ? { discipline: d.discipline } : {}),
      ...(d.captainId !== undefined ? { captainId: d.captainId } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });
  await audit({ userId: session.userId, action: "team.update", tableName: "team", rowId: team!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "team.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { team, error } = await loadOwned(params.id, session);
  if (error) return error;

  await prisma.team.update({ where: { id: team!.id }, data: { active: false, deletedAt: new Date() } });
  await audit({ userId: session.userId, action: "team.deactivate", tableName: "team", rowId: team!.id });
  return NextResponse.json({ ok: true });
}
