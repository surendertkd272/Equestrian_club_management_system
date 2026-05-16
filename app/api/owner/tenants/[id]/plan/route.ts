import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { applyPlan } from "@/lib/plan-engine";
import { PLANS, isPlanKey } from "@/lib/plans";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";

const schema = z.object({ plan: z.enum(PLANS) });

// POST /api/owner/tenants/[id]/plan — change plan and atomically reseed
// OrgFeature to the new bundle. Refuses if the new plan's maxCentres < current
// centre count (TOO_MANY_CENTRES) so a downgrade can't silently strand data.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.change_plan");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (!isPlanKey(parsed.data.plan)) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const result = await applyPlan(params.id, parsed.data.plan, session.ownerId);
  if (!result.ok) {
    const status = result.error === "ORG_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ error: result.error, details: result.details }, { status });
  }

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.plan_changed",
    orgId: params.id,
    before: { plan: result.before },
    after: { plan: result.after },
  });

  return NextResponse.json({ ok: true, plan: result.after });
}
