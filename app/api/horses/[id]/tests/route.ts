// Horse lab tests — Coggins, Glanders (mandatory compliance) + Urination
// (routine diagnostic). Vet + horse.manage roles write; everyone with
// horse read access can list.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createHorseTestSchema } from "@/lib/schemas/horse-test";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const tests = await prisma.horseTest.findMany({
    where: { horseId: params.id },
    orderBy: { testedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ tests });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.prescribe") && !can(session.role, "horse.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const horse = await prisma.horse.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, name: true },
  });
  if (!horse) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence88 = await centreFence(session, horse.centreId);
  if (fence88) {
    return NextResponse.json({ error: fence88 }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createHorseTestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const test = await prisma.horseTest.create({
    data: {
      horseId: horse.id,
      testType: parsed.data.testType,
      result: parsed.data.result,
      testedAt: parsed.data.testedAt ? new Date(parsed.data.testedAt) : new Date(),
      nextDueAt: parsed.data.nextDueAt ? new Date(parsed.data.nextDueAt) : null,
      labName: parsed.data.labName ?? null,
      reportUrl: parsed.data.reportUrl || null,
      notes: parsed.data.notes ?? null,
      recordedByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "horse.test",
    tableName: "horseTest",
    rowId: test.id,
    after: { horseName: horse.name, testType: test.testType, result: test.result },
  });

  return NextResponse.json({ ok: true, test });
}
