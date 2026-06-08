import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { createVendorSchema } from "@/lib/schemas/finance";
import { vendorScopeWhere } from "@/lib/vendor-scope";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  // Own-centre vendors + national (all-India) vendors in the same org.
  const scopeWhere = await vendorScopeWhere(session);
  const vendors = await prisma.vendor.findMany({
    where: {
      ...scopeWhere,
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
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const body = await req.json().catch(() => null);
  const parsed = createVendorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Owner centre: centre-scoped users use their own; HQ admins on the
  // all-centres view pick it via the form (parsed.data.centreId).
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  let centreId = scopeCentre(session);
  if (!centreId && isHQ && parsed.data.centreId) centreId = parsed.data.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  // Guard cross-tenant: the chosen centre must exist (and, for HQ picking
  // from the form, belong to the admin's org).
  const ownerCentre = await prisma.centre.findUnique({ where: { id: centreId }, select: { id: true } });
  if (!ownerCentre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 400 });

  const row = await prisma.vendor.create({
    data: {
      centreId,
      deliveryScope: parsed.data.deliveryScope ?? "centre",
      name: parsed.data.name,
      category: parsed.data.category ?? "other",
      contactName: parsed.data.contactName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      gstin: parsed.data.gstin,
      // Bank details — empty strings stored as null for tidier reads.
      bankAccountName: parsed.data.bankAccountName || null,
      bankAccountNumber: parsed.data.bankAccountNumber || null,
      bankIfsc: parsed.data.bankIfsc?.toUpperCase() || null,
      bankName: parsed.data.bankName || null,
      upiId: parsed.data.upiId || null,
      notes: parsed.data.notes,
      // Category-specific blob (Vet Doctor / Farrier extras). Now a native
      // Json column — pass the object straight through. Drop the field if
      // empty so we don't waste an empty "{}" on every row.
      categorySpecificJson:
        parsed.data.categorySpecific && Object.keys(parsed.data.categorySpecific).length > 0
          ? parsed.data.categorySpecific
          : undefined,
    },
  });
  await audit({ userId: session.userId, action: "vendor.create", tableName: "vendor", rowId: row.id });
  return NextResponse.json({ ok: true, id: row.id });
}
