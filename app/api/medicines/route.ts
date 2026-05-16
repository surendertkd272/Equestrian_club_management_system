import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createMedicineSchema } from "@/lib/schemas/medicine";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "vet-records");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createMedicineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  const medicine = await prisma.medicine.create({
    data: {
      centreId,
      name: d.name,
      generic: d.generic || null,
      category: d.category,
      schedule: d.schedule === "none" ? null : d.schedule,
      batchNo: d.batchNo,
      mfgDate: d.mfgDate ? new Date(d.mfgDate) : null,
      expDate: new Date(d.expDate),
      qty: d.qty,
      reorderThreshold: d.reorderThreshold,
      supplier: d.supplier || null,
      storageLocation: d.storageLocation || null,
      coldChain: d.coldChain ?? false,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "medicine",
    rowId: medicine.id,
    after: { name: medicine.name, batchNo: medicine.batchNo, qty: medicine.qty, expDate: medicine.expDate },
  });

  return NextResponse.json({ id: medicine.id });
}
