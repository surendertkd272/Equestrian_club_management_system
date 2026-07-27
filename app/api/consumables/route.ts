import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { centreScopeWhere } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { createConsumableSchema } from "@/lib/schemas/consumable";

// GET — list consumables for the caller's centre. Optional ?category, ?low=1.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Re-use the vet-records feature flag — consumables are first-aid kit
  // siblings of the medicine cabinet, so they belong on the same toggle.
  const featureBlock = await blockIfFeatureOff(session, "consumables");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const low = url.searchParams.get("low");

  const where: Prisma.ConsumableWhereInput = {};
  // Centre-less roles fall straight through a `role !== "SUPER_ADMIN" &&
  // session.centreId` conjunct with NO filter applied, so this list spanned
  // every organisation on the platform. Same scope the pages use.
  const scope = await centreScopeWhere(session);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN_NO_SCOPE" }, { status: 403 });
  Object.assign(where, scope);
  if (category) where.category = category;

  const rows = await prisma.consumable.findMany({
    where,
    orderBy: { name: "asc" },
  });
  const filtered = low === "1" ? rows.filter((r) => r.qty <= r.reorderThreshold) : rows;
  return NextResponse.json({ rows: filtered });
}

// POST — add a new line item to the cabinet.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "consumables");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createConsumableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  // Resolve centre via picker (HQ) / own centre / body fallback.
  const resolved = await resolveWriteCentre(session, body);
  if (resolved.error) return resolved.error;
  const { centreId } = resolved;

  const row = await prisma.consumable.create({
    data: {
      centreId,
      name: parsed.data.name,
      category: parsed.data.category,
      unit: parsed.data.unit,
      qty: parsed.data.qty,
      reorderThreshold: parsed.data.reorderThreshold,
      supplier: parsed.data.supplier ?? null,
      storageLocation: parsed.data.storageLocation ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  await audit({
    userId: session.userId,
    action: "consumable.create",
    tableName: "consumable",
    rowId: row.id,
    after: { name: row.name, category: row.category, qty: row.qty },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
