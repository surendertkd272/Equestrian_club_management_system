import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { centreScopeWhere } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { createTeamSchema } from "@/lib/schemas/teams";

// GET — list active teams + member counts.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "teams");
  if (featureBlock) return featureBlock;
  const where: Prisma.TeamWhereInput = {};
  // Centre-less roles fall straight through a `role !== "SUPER_ADMIN" &&
  // session.centreId` conjunct with NO filter applied, so this list spanned
  // every organisation on the platform. Same scope the pages use.
  const scope = await centreScopeWhere(session);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN_NO_SCOPE" }, { status: 403 });
  Object.assign(where, scope);

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
  if (!can(session.role, "team.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // HQ users have centreId=null and this form doesn't send a centreId — resolve
  // via the top-bar picker so HQ can create teams for the selected centre.
  const resolved = await resolveWriteCentre(session, body);
  if (resolved.error) return resolved.error;
  const { centreId } = resolved;

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
