// Global (org-wide) payroll deduction config. GET returns the current rules;
// PUT replaces them. Set by SUPER_ADMIN / ADMIN — this is the single place
// the per-status per-day deduction amounts live.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { payrollConfigSchema, parseDeductionRules } from "@/lib/schemas/payroll";

function canEdit(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

// Resolve the caller's org id (HQ users via User.orgId, centre users via centre).
async function resolveOrgId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  return user?.orgId ?? user?.centre?.orgId ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const orgId = await resolveOrgId(session.userId);
  if (!orgId) return NextResponse.json({ rules: {} });
  const cfg = await prisma.payrollConfig.findUnique({ where: { orgId } });
  return NextResponse.json({ rules: parseDeductionRules(cfg?.deductionRulesJson) });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEdit(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const orgId = await resolveOrgId(session.userId);
  if (!orgId) return NextResponse.json({ error: "NO_ORG_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = payrollConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Drop zero/blank entries so the stored map stays clean.
  const rules: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.data.deductionRules)) {
    if (v > 0) rules[k] = v;
  }
  const json = JSON.stringify(rules);

  await prisma.payrollConfig.upsert({
    where: { orgId },
    create: { orgId, deductionRulesJson: json, updatedByUserId: session.userId },
    update: { deductionRulesJson: json, updatedByUserId: session.userId },
  });

  await audit({
    userId: session.userId,
    action: "payroll.config_update",
    tableName: "payrollConfig",
    rowId: orgId,
    after: rules,
  });

  return NextResponse.json({ ok: true, rules });
}
