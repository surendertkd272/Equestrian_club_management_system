import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

const schema = z.object({ batchId: z.string().nullable() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && rider.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (parsed.data.batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: parsed.data.batchId } });
    if (!batch) return NextResponse.json({ error: "BATCH_NOT_FOUND" }, { status: 404 });
    if (batch.centreId !== rider.centreId) {
      return NextResponse.json({ error: "CROSS_CENTRE_BATCH" }, { status: 400 });
    }
  }

  await prisma.rider.update({
    where: { id: rider.id },
    data: { batchId: parsed.data.batchId },
  });

  await audit({
    userId: session.userId,
    action: "rider.assign_batch",
    tableName: "rider",
    rowId: rider.id,
    before: { batchId: rider.batchId },
    after: { batchId: parsed.data.batchId },
  });

  return NextResponse.json({ ok: true });
}
