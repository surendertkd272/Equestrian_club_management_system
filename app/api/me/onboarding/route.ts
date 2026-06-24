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
  return value && typeof value === "object" ? (value as OnboardingState) : {};
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

  const current = await prisma.user.findUnique({ where: { id: session.userId }, select: { onboardingJson: true } });
  const next = readState(current?.onboardingJson);
  const d = parsed.data;
  if (d.tourCompleted) next.tourCompletedAt = new Date().toISOString();
  if (d.checklist) next.checklist = { ...(next.checklist ?? {}), ...d.checklist };
  if (d.dismissChecklist) next.checklistDismissedAt = new Date().toISOString();

  await prisma.user.update({ where: { id: session.userId }, data: { onboardingJson: next } });
  return NextResponse.json({ ok: true, onboarding: next });
}
