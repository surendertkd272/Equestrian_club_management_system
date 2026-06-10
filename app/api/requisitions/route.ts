import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { createRequisitionSchema } from "@/lib/schemas/requisition";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notifyMany } from "@/lib/notify";

// GET — list visible requisitions. Filter:
//   - ?mine=1 → only my submissions
//   - ?queue=manager → things waiting on manager approval (caller must have
//     requisition.approve_manager)
//   - ?queue=accountant → ditto for accountant
//   - default → everything in the caller's scope
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const queue = url.searchParams.get("queue");

  const where: Prisma.RequisitionWhereInput = { ...tenantWhere(centreId, orgId) };
  if (mine) where.requestedByUserId = session.userId;
  if (queue === "manager") {
    if (!can(session.role, "requisition.approve_manager")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    where.stage = "pending_manager";
  } else if (queue === "accountant") {
    if (!can(session.role, "requisition.approve_accountant")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    where.stage = "pending_accountant";
  }

  const rows = await prisma.requisition.findMany({
    where,
    include: { requestedBy: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ requisitions: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "requisition.submit")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createRequisitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Centre resolution: session pin for centre-scoped users; body for SUPER_ADMIN.
  // Validate ownership for HQ so they can't post a requisition into someone
  // else's organisation.
  let centreId: string | null = scopeCentre(session);
  if (!centreId && session.role === "SUPER_ADMIN" && parsed.data.centreId) {
    const c = await prisma.centre.findUnique({
      where: { id: parsed.data.centreId },
      select: { id: true, orgId: true },
    });
    if (!c) {
      return NextResponse.json({ error: "INVALID_CENTRE" }, { status: 400 });
    }
    // Enforce the ownership the comment promises: the body centre must be in
    // the caller's org, else an HQ user could post into another tenant.
    const callerOrgId = await getOrgIdForSession(session);
    if (!callerOrgId || c.orgId !== callerOrgId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
    centreId = c.id;
  }
  if (!centreId) {
    return NextResponse.json(
      { error: "NO_CENTRE_CONTEXT", message: "HQ admins must pick a centre when creating a requisition." },
      { status: 400 },
    );
  }

  const totalEstimatedCost = parsed.data.items.reduce(
    (sum, it) => sum + it.qty * it.estimatedUnitCost,
    0,
  );

  const row = await prisma.requisition.create({
    data: {
      centreId,
      requestedByUserId: session.userId,
      // itemsJson is a jsonb column (post-migration in 81f142a) — pass the
      // array directly; JSON.stringify here would have stored the
      // serialised string as a string-value JSON instead of the array.
      itemsJson: parsed.data.items,
      totalEstimatedCost,
      reason: parsed.data.reason ?? null,
      stage: "pending_manager",
    },
  });

  await audit({
    userId: session.userId,
    action: "requisition.create",
    tableName: "requisition",
    rowId: row.id,
    after: { totalEstimatedCost, itemCount: parsed.data.items.length },
  });

  // Notify everyone who can approve at the manager stage so the requisition
  // doesn't just sit in a list waiting to be discovered. Fire-and-forget;
  // notify() swallows its own errors so the create still succeeds.
  const approvers = await prisma.user.findMany({
    where: {
      centreId,
      status: "active",
      role: { in: ["CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER", "SUPER_ADMIN"] },
    },
    select: { id: true },
  });
  await notifyMany(approvers.map((u) => u.id), {
    centreId,
    type: "requisition.submitted",
    title: "New requisition needs your approval",
    body: `${session.name} submitted a requisition for ₹${Math.round(totalEstimatedCost).toLocaleString("en-IN")} (${parsed.data.items.length} item${parsed.data.items.length === 1 ? "" : "s"}).`,
    link: `/requisitions`,
  });

  return NextResponse.json({ ok: true, id: row.id });
}
