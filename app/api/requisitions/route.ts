import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { createRequisitionSchema } from "@/lib/schemas/requisition";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// GET — list visible requisitions. Filter:
//   - ?mine=1 → only my submissions
//   - ?queue=manager → things waiting on manager approval (caller must have
//     requisition.approve_manager)
//   - ?queue=accountant → ditto for accountant
//   - default → everything in the caller's scope
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const queue = url.searchParams.get("queue");

  const where: any = { ...centreWhere(centreId) };
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

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createRequisitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const totalEstimatedCost = parsed.data.items.reduce(
    (sum, it) => sum + it.qty * it.estimatedUnitCost,
    0,
  );

  const row = await prisma.requisition.create({
    data: {
      centreId,
      requestedByUserId: session.userId,
      itemsJson: JSON.stringify(parsed.data.items),
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

  return NextResponse.json({ ok: true, id: row.id });
}
