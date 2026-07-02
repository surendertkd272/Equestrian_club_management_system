// PATCH /api/staff/[id] — edit a staff member's HR-record fields:
// display name + phone (on the linked User), salary band and the real date of
// joining (on the Staff row). Backdating joiningDate is the main use — it lets
// admins record the true joining date for employees who were part of the club
// before being entered into the system.
//
// Gate: staff.manage (SUPER_ADMIN, ADMIN, CENTRE_MANAGER) — the same permission
// that gates Add Staff. Tenant isolation mirrors the rider PATCH: HQ roles edit
// any centre's staff but ONLY within their own org; centre-scoped roles are
// restricted to their own centre.
//
// Out of scope (handled by the HQ Users flow /api/users/[id]): email, role,
// account status, centre transfer — those carry privilege/identity guards.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { updateStaffSchema } from "@/lib/schemas/staff-update";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const staff = await prisma.staff.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  if (!staff) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Cross-centre / cross-org block — HQ roles (SUPER_ADMIN, ADMIN) edit any
  // centre's staff within their own org; centre-scoped roles only their own
  // centre. (Same shape as the rider PATCH.)
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(staff.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (staff.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Split the payload across the two rows. Only include keys the caller sent so
  // we never clobber an unrelated column with undefined.
  const userData: Record<string, unknown> = {};
  if ("name" in d) userData.name = d.name;
  if ("phone" in d) userData.phone = d.phone ?? null;

  const staffData: Record<string, unknown> = {};
  if ("salaryBand" in d) staffData.salaryBand = d.salaryBand || null;
  // joiningDate is a required (non-null) Date column shipped as YYYY-MM-DD.
  if ("joiningDate" in d && d.joiningDate) staffData.joiningDate = new Date(d.joiningDate);

  if (Object.keys(userData).length === 0 && Object.keys(staffData).length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  // Update both rows atomically so a partial failure can't leave name/phone and
  // the staff record out of sync.
  await prisma.$transaction([
    ...(Object.keys(userData).length
      ? [prisma.user.update({ where: { id: staff.userId }, data: userData })]
      : []),
    ...(Object.keys(staffData).length
      ? [prisma.staff.update({ where: { id: staff.id }, data: staffData })]
      : []),
  ]);

  await audit({
    userId: session.userId,
    action: "staff.update",
    tableName: "staff",
    rowId: staff.id,
    before: {
      name: staff.user.name,
      phone: staff.user.phone,
      salaryBand: staff.salaryBand,
      joiningDate: staff.joiningDate,
    },
    after: {
      name: "name" in userData ? userData.name : staff.user.name,
      phone: "phone" in userData ? userData.phone : staff.user.phone,
      salaryBand: "salaryBand" in staffData ? staffData.salaryBand : staff.salaryBand,
      joiningDate: "joiningDate" in staffData ? staffData.joiningDate : staff.joiningDate,
    },
  });

  return NextResponse.json({ ok: true, id: staff.id });
}
