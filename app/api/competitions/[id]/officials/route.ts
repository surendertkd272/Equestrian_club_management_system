import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { appointOfficialSchema } from "@/lib/schemas/officials";

// GET /api/competitions/[id]/officials — list the assignments. Includes
// each official's name + role so the panel can render without a second
// fetch. Available to anyone with competition.read access.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const officials = await prisma.competitionOfficial.findMany({
    where: { competitionId: comp.id },
    orderBy: [{ role: "asc" }, { appointedAt: "asc" }],
  });
  // Resolve user names in one query. `userId` is a plain string column,
  // no FK relation, so we join manually.
  const userIds = Array.from(new Set(officials.map((o) => o.userId)));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    officials: officials.map((o) => ({
      id: o.id,
      role: o.role,
      classNames: o.classNames,
      appointedAt: o.appointedAt,
      user: userById.get(o.userId) ?? { id: o.userId, name: "(removed user)", email: "", role: "" },
    })),
  });
}

// POST /api/competitions/[id]/officials — appoint an official. Idempotent
// via the (competitionId, userId, role) unique constraint — duplicates
// return 200 with no-op.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = appointOfficialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify the user belongs to this centre (or is a SUPER_ADMIN in the
  // same org) — prevents accidentally appointing someone from a peer
  // tenant as your competition's official.
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { centreId: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  if (target.role !== "SUPER_ADMIN" && target.centreId !== comp.centreId) {
    return NextResponse.json({ error: "USER_NOT_IN_CENTRE" }, { status: 400 });
  }

  const row = await prisma.competitionOfficial.upsert({
    where: {
      competitionId_userId_role: {
        competitionId: comp.id,
        userId: parsed.data.userId,
        role: parsed.data.role,
      },
    },
    create: {
      competitionId: comp.id,
      userId: parsed.data.userId,
      role: parsed.data.role,
      classNames: parsed.data.classNames ?? null,
      appointedBy: session.userId,
    },
    update: { classNames: parsed.data.classNames ?? null },
  });

  await audit({
    userId: session.userId,
    action: "competition.official_appointed",
    tableName: "competitionOfficial",
    rowId: row.id,
    after: { userId: row.userId, role: row.role, classNames: row.classNames },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
