import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";

// POST /api/riders/bulk-batch — assign many riders to one batch (or clear it).
//
// Rider→batch was previously settable only one rider at a time, from the rider
// detail page. That made the batch link effectively unusable at scale: 94 of 99
// riders in production have no batch, and since attendance rosters come from
// batch membership, attendance has never been marked once in three months.
// Nobody was going to make 94 individual edits.
//
// Every rider is fenced individually rather than trusting the ids in the body —
// a bulk endpoint is exactly where a cross-centre id would otherwise slip in.
const schema = z.object({
  riderIds: z.array(z.string().min(1)).min(1).max(500),
  batchId: z.string().min(1).nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const { riderIds, batchId } = parsed.data;

  const riders = await prisma.rider.findMany({
    where: { id: { in: riderIds } },
    select: { id: true, centreId: true, batchId: true },
  });
  if (riders.length === 0) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // One fence check per distinct centre rather than per rider — same guarantee,
  // far fewer round-trips on a 200-rider selection.
  for (const centreId of new Set(riders.map((r) => r.centreId))) {
    const fence = await centreFence(session, centreId);
    if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  }

  if (batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) return NextResponse.json({ error: "BATCH_NOT_FOUND" }, { status: 404 });
    const fence = await centreFence(session, batch.centreId);
    if (fence) return NextResponse.json({ error: fence }, { status: 403 });
    // A rider can only join a batch at their own centre.
    if (riders.some((r) => r.centreId !== batch.centreId)) {
      return NextResponse.json({ error: "CROSS_CENTRE_BATCH" }, { status: 400 });
    }
  }

  const ids = riders.map((r) => r.id);
  const { count } = await prisma.rider.updateMany({ where: { id: { in: ids } }, data: { batchId } });

  await audit({
    userId: session.userId,
    action: "rider.bulk_assign_batch",
    tableName: "rider",
    // No single row to point at; the affected ids live in `after` so the trail
    // still answers "who moved these riders, and when".
    rowId: batchId ?? "unassign",
    before: { riders: riders.map((r) => ({ id: r.id, batchId: r.batchId })) },
    after: { batchId, count },
  });

  return NextResponse.json({ ok: true, count });
}
