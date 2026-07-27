import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
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
  // HQ roles carry centreId = null, so this locked ADMIN out of every centre
  // while org-fencing nobody.
  const fence = await centreFence(session, horse.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }
  if (!horse.feedPlan) return NextResponse.json({ plan: null });
  return NextResponse.json({
    plan: {
      id: horse.feedPlan.id,
      // rationsJson is a jsonb column — already parsed by Prisma.
      rations: horse.feedPlan.rationsJson,
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
  // HQ roles carry centreId = null, so this locked ADMIN out of every centre
  // while org-fencing nobody.
  const fence = await centreFence(session, horse.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = upsertFeedPlanSchema.safeParse({ ...body, horseId: horse.id });
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // rationsJson is a jsonb column — pass the validated rations array directly.
  const saved = await prisma.feedPlan.upsert({
    where: { horseId: horse.id },
    create: { centreId: horse.centreId, horseId: horse.id, rationsJson: d.rations, notes: d.notes ?? null, updatedBy: session.userId },
    update: { rationsJson: d.rations, notes: d.notes ?? null, updatedBy: session.userId },
  });

  await audit({
    userId: session.userId,
    action: "horse.feed_plan_saved",
    tableName: "feedPlan",
    rowId: saved.id,
    // rationsJson is already-parsed — no JSON.parse needed for the audit shot.
    before: horse.feedPlan ? { rations: horse.feedPlan.rationsJson } : null,
    after: { rations: d.rations },
  });

  return NextResponse.json({ ok: true });
}
