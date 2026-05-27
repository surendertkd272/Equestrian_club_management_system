import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateUserSchema } from "@/lib/schemas/user-admin";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PATCH /api/users/[id] — HQ user edit.
// Guards against locking yourself out:
//   - You can't suspend, demote, or move the LAST active SUPER_ADMIN
//   - You can't suspend or demote YOURSELF (would lock you out mid-session)
//   - Email changes are uniqueness-checked with a friendly 409
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ADMIN may manage everyone except the SUPER_ADMIN tier — can't edit a
  // super-admin nor promote anyone INTO super-admin (no privilege escalation).
  if (session.role === "ADMIN" && (target.role === "SUPER_ADMIN" || d.role === "SUPER_ADMIN")) {
    return NextResponse.json({ error: "FORBIDDEN_SUPER_ADMIN" }, { status: 403 });
  }

  // Last-super-admin / self-lockout guards. Treat any "you're about to lose your
  // own admin powers" change as a request the caller didn't mean to make.
  const willDemoteRole = d.role !== undefined && d.role !== target.role;
  const willSuspend = d.status === "suspended" && target.status !== "suspended";
  const wouldRemoveAdminPower = (willDemoteRole && target.role === "SUPER_ADMIN") || (willSuspend && target.role === "SUPER_ADMIN");

  if (wouldRemoveAdminPower) {
    const activeAdmins = await prisma.user.count({
      where: { role: "SUPER_ADMIN", status: "active" },
    });
    if (activeAdmins <= 1) {
      return NextResponse.json({ error: "LAST_SUPER_ADMIN" }, { status: 409 });
    }
  }
  if (target.id === session.userId && (willSuspend || willDemoteRole)) {
    return NextResponse.json({ error: "CANNOT_DEMOTE_SELF" }, { status: 409 });
  }

  // Email uniqueness check (when actually changing).
  if (d.email !== undefined && d.email !== target.email) {
    const dupe = await prisma.user.findUnique({ where: { email: d.email } });
    if (dupe) return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }

  // Validate centreId points at an existing centre (or null for HQ).
  if (d.centreId !== undefined && d.centreId !== null) {
    const c = await prisma.centre.findUnique({ where: { id: d.centreId }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
      ...(d.role !== undefined ? { role: d.role } : {}),
      ...(d.centreId !== undefined ? { centreId: d.centreId } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "user.update",
    tableName: "user",
    rowId: target.id,
    before: {
      name: target.name,
      email: target.email,
      role: target.role,
      centreId: target.centreId,
      status: target.status,
    },
    after: {
      name: updated.name,
      email: updated.email,
      role: updated.role,
      centreId: updated.centreId,
      status: updated.status,
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/users/[id] — HQ removes a user account permanently.
// Several guards (defence in depth — the UI also confirms):
//   1. Can't delete yourself (you'd lose the session mid-call).
//   2. Can't delete the last active SUPER_ADMIN (org lockout).
//   3. If the user is linked to a Rider via Rider.userId, refuse with
//      USER_LINKED_TO_RIDER — caller should revoke portal access via
//      /api/riders/[id]/portal-access first.
//   4. If the user is a Centre.managerId, refuse with USER_IS_CENTRE_MANAGER —
//      caller should reassign the centre's manager first.
//   5. If the user is a parent (ParentLink rows exist), refuse with
//      USER_HAS_PARENT_LINKS — caller should unlink first.
// All other dependent rows (Notification, AuditLog.userId fk, StaffAttendance,
// LeaveRequest, Staff) cascade or null out per their schema definitions.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, status: true, name: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ADMIN can't delete a SUPER_ADMIN account.
  if (session.role === "ADMIN" && target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN_SUPER_ADMIN" }, { status: 403 });
  }

  // Guard 1 — self
  if (target.id === session.userId) {
    return NextResponse.json({ error: "CANNOT_DELETE_SELF" }, { status: 409 });
  }
  // Guard 2 — last super admin
  if (target.role === "SUPER_ADMIN" && target.status === "active") {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: "SUPER_ADMIN", status: "active", NOT: { id: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "LAST_SUPER_ADMIN" }, { status: 409 });
    }
  }
  // Guards 3-5 — relational impact
  const [linkedRider, centreOwned, parentLinks] = await Promise.all([
    prisma.rider.findFirst({ where: { userId: target.id }, select: { id: true, firstName: true, lastName: true } }),
    prisma.centre.findFirst({ where: { managerId: target.id }, select: { id: true, name: true } }),
    prisma.parentLink.count({ where: { parentUserId: target.id } }),
  ]);
  if (linkedRider) {
    return NextResponse.json(
      {
        error: "USER_LINKED_TO_RIDER",
        details: { riderId: linkedRider.id, riderName: `${linkedRider.firstName} ${linkedRider.lastName}` },
      },
      { status: 409 },
    );
  }
  if (centreOwned) {
    return NextResponse.json(
      { error: "USER_IS_CENTRE_MANAGER", details: { centreId: centreOwned.id, centreName: centreOwned.name } },
      { status: 409 },
    );
  }
  if (parentLinks > 0) {
    return NextResponse.json(
      { error: "USER_HAS_PARENT_LINKS", details: { links: parentLinks } },
      { status: 409 },
    );
  }

  // Audit before delete — we won't have the row afterwards.
  await audit({
    userId: session.userId,
    action: "user.delete",
    tableName: "user",
    rowId: target.id,
    before: { name: target.name, email: target.email, role: target.role, status: target.status },
  });

  await prisma.user.delete({ where: { id: target.id } });
  return NextResponse.json({ ok: true });
}
