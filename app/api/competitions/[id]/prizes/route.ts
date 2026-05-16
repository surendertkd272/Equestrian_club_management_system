import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createPrizeSchema } from "@/lib/schemas/competition-ops";

// GET — list prizes for the competition.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const rows = await prisma.prizeAward.findMany({
    where: { competitionId: params.id },
    orderBy: [{ className: "asc" }, { placement: "asc" }],
    include: { sponsor: { select: { id: true, name: true, tier: true } } },
  });
  return NextResponse.json({ rows });
}

// POST — upsert a prize. Unique by (competitionId, className, placement).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "competitions");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createPrizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const comp = await prisma.competition.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.prizeAward.upsert({
    where: {
      competitionId_className_placement: {
        competitionId: comp.id,
        className: d.className,
        placement: d.placement,
      },
    },
    create: {
      competitionId: comp.id,
      className: d.className,
      placement: d.placement,
      title: d.title,
      cashAmount: d.cashAmount ?? null,
      trophyLabel: d.trophyLabel ?? null,
      sponsoredById: d.sponsoredById ?? null,
      notes: d.notes ?? null,
    },
    update: {
      title: d.title,
      cashAmount: d.cashAmount ?? null,
      trophyLabel: d.trophyLabel ?? null,
      sponsoredById: d.sponsoredById ?? null,
      notes: d.notes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "competition.prize_upsert",
    tableName: "prizeAward",
    rowId: row.id,
    after: { className: d.className, placement: d.placement, cashAmount: d.cashAmount },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
