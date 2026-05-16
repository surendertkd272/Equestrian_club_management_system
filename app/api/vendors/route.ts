import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { createVendorSchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const centreId = scopeCentre(session);
  const vendors = await prisma.vendor.findMany({
    where: { ...centreWhere(centreId), active: true },
    orderBy: { name: "asc" },
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
      contactName: parsed.data.contactName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      gstin: parsed.data.gstin,
      notes: parsed.data.notes,
    },
  });
  await audit({ userId: session.userId, action: "vendor.create", tableName: "vendor", rowId: row.id });
  return NextResponse.json({ id: row.id });
}
