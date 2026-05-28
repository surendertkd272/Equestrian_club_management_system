import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { DEFAULT_DRESSAGE_TESTS, dressageMaxScore, type DressageMovement, type DressageCollective } from "@/lib/dressage";

// GET — list active tests, seed defaults on first read.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const existing = await prisma.dressageTest.findMany({ select: { code: true } });
  const have = new Set(existing.map((e) => e.code));
  const missing = DEFAULT_DRESSAGE_TESTS.filter((t) => !have.has(t.code));
  if (missing.length > 0) {
    await prisma.dressageTest.createMany({
      data: missing.map((t) => ({
        code: t.code,
        name: t.name,
        level: t.level,
        body: t.body,
        // jsonb columns — pass the arrays directly (post-migration in 81f142a).
        movementsJson: t.movements,
        collectiveMarksJson: t.collectives,
        maxScore: dressageMaxScore(t.movements, t.collectives),
        active: true,
      })),
    });
  }
  const rows = await prisma.dressageTest.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return NextResponse.json({ tests: rows });
}

const movementSchema = z.object({
  no: z.number().int().min(1),
  letter: z.string().max(20),
  description: z.string().max(300),
  coefficient: z.number().min(0.5).max(5),
});
const collectiveSchema = z.object({ name: z.string().max(80), coefficient: z.number().min(0.5).max(5) });
const createSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(1).max(120),
  level: z.string().max(40),
  body: z.string().max(40).default("custom"),
  movements: z.array(movementSchema).min(1).max(60),
  collectives: z.array(collectiveSchema).max(10).default([]),
});

// POST — create a custom test. SUPER_ADMIN only — the test catalog is
// shared across all centres and you don't want one centre poisoning
// everyone else's scoring with a typo-laden test.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  try {
    const row = await prisma.dressageTest.create({
      data: {
        code: d.code,
        name: d.name,
        level: d.level,
        body: d.body,
        // jsonb columns — pass the arrays directly. The d.movements /
        // d.collectives narrows from createSchema match the Zod shapes
        // exactly, so the cast is just naming for downstream typing.
        movementsJson: d.movements as DressageMovement[],
        collectiveMarksJson: d.collectives as DressageCollective[],
        maxScore: dressageMaxScore(d.movements as DressageMovement[], d.collectives as DressageCollective[]),
      },
    });
    await audit({
      userId: session.userId,
      action: "dressage_test.create",
      tableName: "dressageTest",
      rowId: row.id,
      after: { code: row.code, name: row.name, level: row.level },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_CODE" }, { status: 409 });
    }
    throw e;
  }
}
