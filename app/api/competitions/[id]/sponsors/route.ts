import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createSponsorSchema } from "@/lib/schemas/competition-ops";

// GET — list sponsors for the competition, ordered by tier importance.
const TIER_RANK: Record<string, number> = {
  title: 0,
  platinum: 1,
  gold: 2,
  silver: 3,
  bronze: 4,
  partner: 5,
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const rows = await prisma.sponsor.findMany({
    where: { competitionId: params.id },
  });
  rows.sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9));
  return NextResponse.json({ rows });
}

// POST — add a sponsor.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "competitions");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createSponsorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.sponsor.create({
    data: {
      competitionId: comp.id,
      name: parsed.data.name,
      tier: parsed.data.tier,
      contactName: parsed.data.contactName || null,
      contactPhone: parsed.data.contactPhone || null,
      contactEmail: parsed.data.contactEmail || null,
      contribution: parsed.data.contribution ?? null,
      notes: parsed.data.notes || null,
      logoUrl: parsed.data.logoUrl || null,
    },
  });

  await audit({
    userId: session.userId,
    action: "competition.sponsor_add",
    tableName: "sponsor",
    rowId: row.id,
    after: { name: row.name, tier: row.tier, contribution: row.contribution },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
