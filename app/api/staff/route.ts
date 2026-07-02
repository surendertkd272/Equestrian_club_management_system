import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth";
import { createStaffSchema } from "@/lib/schemas/staff";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });

  const passwordHash = await hashPassword(d.password);

  const user = await prisma.user.create({
    data: {
      email: d.email,
      name: d.name,
      phone: d.phone || null,
      role: d.role,
      centreId,
      passwordHash,
      status: "active",
    },
  });

  const staff = await prisma.staff.create({
    data: {
      centreId,
      userId: user.id,
      role: d.role,
      salaryBand: d.salaryBand || null,
      ...(d.joiningDate ? { joiningDate: new Date(d.joiningDate) } : {}),
      status: "active",
      aadhaarUrl: d.aadhaarUrl || null,
      policeVerificationUrl: d.policeVerificationUrl || null,
      policeVerifiedAt: d.policeVerificationUrl ? new Date() : null,
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "staff",
    rowId: staff.id,
    after: { userId: user.id, role: d.role, name: d.name, email: d.email },
  });

  return NextResponse.json({ id: staff.id, userId: user.id });
}
