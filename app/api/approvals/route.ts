import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createApprovalSchema } from "@/lib/schemas/approvals";

// GET — list approvals for the caller's centre. Filters: ?status, ?entityType.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "approvals");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const entityType = url.searchParams.get("entityType");

  const where: Prisma.ApprovalRequestWhereInput = {};
  if (session.role !== "SUPER_ADMIN" && session.centreId) where.centreId = session.centreId;
  if (status) where.status = status;
  if (entityType) where.entityType = entityType;

  const rows = await prisma.approvalRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ rows });
}

// POST — anyone with a session in a centre can raise an approval. The manager
// gets a notification.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "approvals");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });

  const row = await prisma.approvalRequest.create({
    data: {
      centreId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      requestedBy: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "approval.create",
    tableName: "approvalRequest",
    rowId: row.id,
    after: { entityType: row.entityType, entityId: row.entityId, title: row.title },
  });

  await notifyCentreManager(centreId, {
    type: "approval.requested",
    title: `Approval needed: ${parsed.data.title}`,
    body: parsed.data.body ?? `Type: ${parsed.data.entityType}`,
    link: "/approvals",
    payload: { approvalId: row.id, entityType: row.entityType, entityId: row.entityId },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
