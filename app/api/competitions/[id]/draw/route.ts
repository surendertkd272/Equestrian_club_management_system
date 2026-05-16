import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { drawLotsSchema } from "@/lib/schemas/competition-ops";

// POST /api/competitions/[id]/draw — run a draw of lots for one class.
//   1. Loads every non-withdrawn CompetitionEntry in (competitionId, className).
//   2. Deletes any existing StartListEntry rows for that class (re-draw).
//   3. Shuffles using a cryptographically random Fisher-Yates and writes new rows.
//   4. If `finalise=true`, sets Competition.drawCompleted=true (UI then treats
//      the start list as locked).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "competitions");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = drawLotsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const entries = await prisma.competitionEntry.findMany({
    where: {
      competitionId: comp.id,
      className: parsed.data.className,
      status: { not: "withdrawn" },
    },
    select: { id: true },
  });
  if (entries.length === 0) {
    return NextResponse.json({ error: "NO_ENTRIES" }, { status: 409 });
  }

  // Fisher-Yates with crypto-random ints
  const ids = entries.map((e) => e.id);
  const cryptoSrc = await import("node:crypto");
  for (let i = ids.length - 1; i > 0; i--) {
    const j = cryptoSrc.randomInt(0, i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  await prisma.$transaction([
    prisma.startListEntry.deleteMany({
      where: { competitionId: comp.id, className: parsed.data.className },
    }),
    ...ids.map((entryId, idx) =>
      prisma.startListEntry.create({
        data: {
          competitionId: comp.id,
          className: parsed.data.className,
          entryId,
          order: idx + 1,
        },
      }),
    ),
    ...(parsed.data.finalise
      ? [prisma.competition.update({ where: { id: comp.id }, data: { drawCompleted: true } })]
      : []),
  ]);

  await audit({
    userId: session.userId,
    action: "competition.draw",
    tableName: "competition",
    rowId: comp.id,
    after: { className: parsed.data.className, entries: ids.length, finalise: !!parsed.data.finalise },
  });

  return NextResponse.json({ ok: true, count: ids.length, finalised: !!parsed.data.finalise });
}

// GET /api/competitions/[id]/draw?className=Open — return the current start
// list for one class.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const className = url.searchParams.get("className");
  if (!className) return NextResponse.json({ error: "className required" }, { status: 400 });

  const rows = await prisma.startListEntry.findMany({
    where: { competitionId: params.id, className },
    orderBy: { order: "asc" },
    include: {
      entry: {
        include: {
          rider: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  return NextResponse.json({ rows });
}
