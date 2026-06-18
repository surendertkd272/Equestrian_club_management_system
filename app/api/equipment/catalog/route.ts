import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createCatalogSchema } from "@/lib/schemas/equipment";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// GET — every authenticated user can read the catalog (centre inventory
// pages need it to know what items exist). Filtered to active=true unless
// explicitly requested otherwise.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const showInactive = url.searchParams.get("showInactive") === "1";
  const rows = await prisma.equipmentCatalog.findMany({
    where: showInactive ? {} : { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

// POST — HQ adds a catalog row. Centre staff can't extend the catalog;
// the point is a consistent shopping list across every club.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createCatalogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await prisma.equipmentCatalog.create({ data: parsed.data });
    await audit({
      userId: session.userId,
      action: "equipment_catalog.create",
      tableName: "equipmentCatalog",
      rowId: row.id,
      after: { code: row.code, category: row.category, defaultThreshold: row.defaultThreshold },
    });
    return NextResponse.json({ id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_CODE" }, { status: 409 });
    }
    throw e;
  }
}
