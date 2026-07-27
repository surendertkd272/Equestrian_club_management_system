import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { updateUserSchema } from "@/lib/schemas/user-admin";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { callerSharesOrgWithUser } from "@/lib/authz-org";

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

  // Cross-org guard: User is RLS-permissive, so an HQ admin of another org
  // could otherwise edit this user. Bind the target to the caller's org.
  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

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

  // Validate centreId points at an existing centre (or null for HQ) — and at
  // one the caller may actually reach. Checking only that the centre EXISTS let
  // one tenant's admin move an account into ANOTHER tenant's centre, planting a
  // user inside an organisation they have no rights over.
  if (d.centreId !== undefined && d.centreId !== null) {
    const c = await prisma.centre.findUnique({ where: { id: d.centreId }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });
    const destFence = await centreFence(session, d.centreId);
    if (destFence) return NextResponse.json({ error: destFence }, { status: 403 });
  }

  // A role change or a suspension must take effect on the user's NEXT request,
  // not up to 8h later when their JWT expires — bump tokenVersion to invalidate
  // their current session (getSession compares it). Without this, e.g. a
  // suspended/demoted coach keeps their old access until the token lapses.
  const kickSession = willDemoteRole || willSuspend;

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
      ...(d.role !== undefined ? { role: d.role } : {}),
      ...(d.centreId !== undefined ? { centreId: d.centreId } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(kickSession ? { tokenVersion: { increment: 1 } } : {}),
    },
  });

  // Keep the linked Staff record's role in lock-step with the User role. Staff
  // has its own `role` column (used by the staff profile / gate log / print
  // packet); without this, changing a user COACH→GROOM in /users left the staff
  // profile still showing COACH. updateMany is a no-op for non-staff users.
  if (willDemoteRole && d.role !== undefined) {
    await prisma.staff.updateMany({ where: { userId: target.id }, data: { role: d.role } });
  }

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
//   3. Rider link (Rider.userId) → USER_LINKED_TO_RIDER (revoke portal access first).
//   4. Centre.managerId → USER_IS_CENTRE_MANAGER (reassign the manager first).
//   5. Parent (ParentLink rows) → USER_HAS_PARENT_LINKS (unlink first).
//   6. Operational / financial history → USER_HAS_RECORDS. Staff, Requisition,
//      CoachDailyUpdate, VetVisit, SalaryPayment, EmployeeAdvance,
//      SeparationNotice, StaffGateEvent and AuditRun all reference a user with
//      ON DELETE RESTRICT, so a hard delete would be refused by the DB anyway —
//      and these records must be kept. Suspend or offboard the user instead.
//      A P2003 try/catch backstops any RESTRICT relation not pre-checked here.
// Cascade / SET NULL relations (Notification, LeaveRequest, StaffAttendance,
// AuditLog, Rider.userId, …) are cleaned up automatically by the DB.
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

  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

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

  // Guard 6 — operational / financial RESTRICT relations. These records must be
  // kept, so the user can't be hard-deleted; the admin should suspend or
  // offboard them. We name what's blocking so the UI can say so.
  const [staffRec, reqs, coachUpdates, vetVisits, salary, advances, separations, gate, auditRuns] = await Promise.all([
    prisma.staff.count({ where: { userId: target.id } }),
    prisma.requisition.count({ where: { requestedByUserId: target.id } }),
    prisma.coachDailyUpdate.count({ where: { coachUserId: target.id } }),
    prisma.vetVisit.count({ where: { vetUserId: target.id } }),
    prisma.salaryPayment.count({ where: { userId: target.id } }),
    prisma.employeeAdvance.count({ where: { userId: target.id } }),
    prisma.separationNotice.count({ where: { userId: target.id } }),
    prisma.staffGateEvent.count({ where: { staffUserId: target.id } }),
    prisma.auditRun.count({ where: { inspectorUserId: target.id } }),
  ]);
  const kinds: string[] = [];
  if (staffRec) kinds.push("a staff record");
  if (salary || advances) kinds.push("payroll/advance history");
  if (reqs) kinds.push("requisitions");
  if (coachUpdates) kinds.push("coach daily updates");
  if (vetVisits) kinds.push("vet visits");
  if (gate) kinds.push("gate logs");
  if (separations) kinds.push("a separation record");
  if (auditRuns) kinds.push("inspection runs");
  if (kinds.length > 0) {
    return NextResponse.json({ error: "USER_HAS_RECORDS", details: { kinds } }, { status: 409 });
  }

  try {
    await prisma.user.delete({ where: { id: target.id } });
  } catch (e: any) {
    // Backstop: a RESTRICT relation not pre-checked above (or added later) —
    // surface the same clear 409 instead of an opaque 500.
    if (e?.code === "P2003") {
      return NextResponse.json({ error: "USER_HAS_RECORDS", details: { kinds: ["linked records"] } }, { status: 409 });
    }
    throw e;
  }

  // Audit AFTER the delete succeeds — a blocked/failed delete must not log a
  // phantom "user.delete" entry.
  await audit({
    userId: session.userId,
    action: "user.delete",
    tableName: "user",
    rowId: target.id,
    before: { name: target.name, email: target.email, role: target.role, status: target.status },
  });
  return NextResponse.json({ ok: true });
}
