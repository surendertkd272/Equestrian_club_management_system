import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { upsertFeedPlanSchema } from "@/lib/schemas/feed-plan";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, feedPlan: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!horse.feedPlan) return NextResponse.json({ plan: null });
  return NextResponse.json({
    plan: {
      id: horse.feedPlan.id,
      rations: JSON.parse(horse.feedPlan.rationsJson),
      notes: horse.feedPlan.notes,
      updatedAt: horse.feedPlan.updatedAt,
    },
  });
}

// PUT replaces the plan wholesale — a feed plan is one row per horse and
// it's simpler to overwrite the rations array than to PATCH individual
// items. Audit captures the before/after for vet review.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, feedPlan: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = upsertFeedPlanSchema.safeParse({ ...body, horseId: horse.id });
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const rationsJson = JSON.stringify(d.rations);
  const saved = await prisma.feedPlan.upsert({
    where: { horseId: horse.id },
    create: { centreId: horse.centreId, horseId: horse.id, rationsJson, notes: d.notes ?? null, updatedBy: session.userId },
    update: { rationsJson, notes: d.notes ?? null, updatedBy: session.userId },
  });

  await audit({
    userId: session.userId,
    action: "horse.feed_plan_saved",
    tableName: "feedPlan",
    rowId: saved.id,
    before: horse.feedPlan ? { rations: JSON.parse(horse.feedPlan.rationsJson) } : null,
    after: { rations: d.rations },
  });

  return NextResponse.json({ ok: true });
}
