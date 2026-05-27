// List + create deworming entries for a horse. The schedule is a simple
// log: schedule a dose, mark it given when administered, optionally seed
// the next one. See lib/schemas/deworming.ts for shape.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createDewormingSchema } from "@/lib/schemas/deworming";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== horse.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const rows = await prisma.dewormingSchedule.findMany({
    where: { horseId: params.id },
    orderBy: [{ givenAt: "desc" }, { scheduledAt: "desc" }],
  });
  return NextResponse.json({ entries: rows });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage") && !can(session.role, "horse.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== horse.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  // Override horseId from path so the URL is authoritative.
  const parsed = createDewormingSchema.safeParse({ ...body, horseId: params.id });
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.dewormingSchedule.create({
    data: {
      horseId: parsed.data.horseId,
      product: parsed.data.product,
      scheduledAt: new Date(parsed.data.scheduledAt),
      notes: parsed.data.notes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "deworming.schedule",
    tableName: "dewormingSchedule",
    rowId: row.id,
    after: { product: row.product, scheduledAt: row.scheduledAt },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
