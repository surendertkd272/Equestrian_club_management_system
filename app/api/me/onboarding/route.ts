// The caller's own onboarding state (guided tour + future activation checklist).
// Self-scoped: reads/writes only the signed-in user's row, so no extra perm
// gate is needed. Not blocked on read-only tenants — this is personal UI state,
// not business data.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type OnboardingState = {
  tourCompletedAt?: string;
  checklist?: Record<string, boolean>;
  checklistDismissedAt?: string;
  dismissedTips?: string[];
};

function readState(value: unknown): OnboardingState {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as OnboardingState) : {};
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { onboardingJson: true } });
  return NextResponse.json({ onboarding: readState(user?.onboardingJson) });
}

const patchSchema = z
  .object({
    // Marks the guided tour finished/skipped; the server stamps the timestamp.
    tourCompleted: z.boolean().optional(),
    // Activation-checklist item toggles, merged into existing state.
    checklist: z.record(z.boolean()).optional(),
    // Hide the checklist card for good; the server stamps the timestamp.
    dismissChecklist: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  const userId = session.userId;
  const now = new Date().toISOString();

  // Apply each field with an atomic jsonb merge so overlapping PATCHes (e.g. the
  // auto-tour finishing while a checklist item is ticked) can't clobber one
  // another. Postgres row-locks the UPDATE, so `||` / jsonb_set read the latest
  // committed value: top-level keys shallow-merge via `||`; the nested checklist
  // deep-merges so prior ticks survive. (These raw writes still carry the RLS
  // tenant GUC — the prisma client extension wraps $executeRaw too.)
  if (d.tourCompleted) {
    await prisma.$executeRaw`UPDATE "User" SET "onboardingJson" = COALESCE("onboardingJson", '{}'::jsonb) || jsonb_build_object('tourCompletedAt', ${now}::text) WHERE id = ${userId}`;
  }
  if (d.dismissChecklist) {
    await prisma.$executeRaw`UPDATE "User" SET "onboardingJson" = COALESCE("onboardingJson", '{}'::jsonb) || jsonb_build_object('checklistDismissedAt', ${now}::text) WHERE id = ${userId}`;
  }
  if (d.checklist) {
    await prisma.$executeRaw`UPDATE "User" SET "onboardingJson" = jsonb_set(COALESCE("onboardingJson", '{}'::jsonb), '{checklist}', COALESCE("onboardingJson" -> 'checklist', '{}'::jsonb) || ${JSON.stringify(d.checklist)}::jsonb) WHERE id = ${userId}`;
  }

  const fresh = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingJson: true } });
  return NextResponse.json({ ok: true, onboarding: readState(fresh?.onboardingJson) });
}
