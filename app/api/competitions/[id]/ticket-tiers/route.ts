import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  priceInr: z.coerce.number().int().min(0).max(1_000_000).default(0),
  capacity: z.coerce.number().int().min(1).max(100_000).optional().nullable(),
  description: z.string().max(300).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(50).default(0),
  active: z.boolean().default(true),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const tiers = await prisma.ticketTier.findMany({
    where: { competitionId: params.id },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { tickets: true } } },
  });
  return NextResponse.json({ tiers });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const tier = await prisma.ticketTier.create({
      data: {
        competitionId: params.id,
        ...parsed.data,
        capacity: parsed.data.capacity ?? null,
        description: parsed.data.description ?? null,
      },
    });
    await audit({
      userId: session.userId,
      action: "competition.ticket_tier_created",
      tableName: "ticketTier",
      rowId: tier.id,
      after: { name: tier.name, priceInr: tier.priceInr },
    });
    return NextResponse.json({ ok: true, id: tier.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    throw e;
  }
}
