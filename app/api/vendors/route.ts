import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { createVendorSchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const vendors = await prisma.vendor.findMany({
    where: {
      ...centreWhere(centreId),
      active: true,
      ...(category ? { category } : {}),
    },
    include: { centre: { select: { name: true, slug: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ vendors });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createVendorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const row = await prisma.vendor.create({
    data: {
      centreId,
      name: parsed.data.name,
      category: parsed.data.category ?? "other",
      contactName: parsed.data.contactName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      gstin: parsed.data.gstin,
      notes: parsed.data.notes,
      // Stringify the category-specific blob (Vet Doctor / Farrier extras).
      // Drop the field if empty so we don't waste a "{}" on every row.
      categorySpecificJson:
        parsed.data.categorySpecific && Object.keys(parsed.data.categorySpecific).length > 0
          ? JSON.stringify(parsed.data.categorySpecific)
          : null,
    },
  });
  await audit({ userId: session.userId, action: "vendor.create", tableName: "vendor", rowId: row.id });
  return NextResponse.json({ ok: true, id: row.id });
}
