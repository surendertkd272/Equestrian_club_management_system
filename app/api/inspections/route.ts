// Start a manual inspection / audit run. Seeds the scope's default checklist
// lines so the inspector has a ready sheet. Permission: INSPECTION_OFFICER
// (external auditor) + admins + centre manager.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { scopeCentreForRoute } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { startAuditSchema, AUDIT_TEMPLATES, CAN_INSPECT } from "@/lib/schemas/audit-run";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_INSPECT.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // INSPECTION_OFFICER + centre roles are pinned to their own centre; HQ can
  // pick via the centre filter.
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = scoped.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  // HQ picks the centre via the ew_hq_centre cookie (read inside scopeCentre).
  // That centreId is HQ-controlled input we're about to write against, so
  // validate it belongs to the caller's org before creating the run — a stale
  // or forged cookie must not seed an audit run in another org's centre.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  if ((await getOrgIdForCentre(centreId)) !== orgId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = startAuditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const template = AUDIT_TEMPLATES[parsed.data.scope] ?? [];
  const run = await prisma.auditRun.create({
    data: {
      centreId,
      inspectorUserId: session.userId,
      scope: parsed.data.scope,
      items: {
        create: template.map((t) => ({ area: t.area, label: t.label })),
      },
    },
  });

  await audit({
    userId: session.userId,
    action: "inspection.start",
    tableName: "auditRun",
    rowId: run.id,
    after: { scope: parsed.data.scope, items: template.length },
  });

  return NextResponse.json({ ok: true, id: run.id });
}
