// Approve or reject a pending_approval user (staff hiring invite flow).
// Approve = flip to active + generate a temp password the admin shares
// with the new hire. Reject = flip to suspended with a note.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { callerSharesOrgWithUser } from "@/lib/authz-org";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(300).optional(),
});

function generateTempPassword(): string {
  // 12 chars, mixed case + digits, no ambiguous letters. Caller emails
  // / WhatsApps this to the new hire; they rotate on first sign-in via
  // the existing /account/rotate flow (User.mustChangePassword = true).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const buf = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Only HQ + centre managers can approve. Activates any user still sitting in
  // pending_approval (e.g. legacy staff-invite hires); new hires now come
  // through Employee Onboarding instead.
  const isApprover =
    session.role === "SUPER_ADMIN" ||
    session.role === "ADMIN" ||
    session.role === "CENTRE_MANAGER";
  if (!isApprover) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, centreId: true, status: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }
  if (target.status !== "pending_approval") {
    return NextResponse.json({ error: "NOT_PENDING", status: target.status }, { status: 409 });
  }
  // Cross-centre guard for centre managers — they can only approve their
  // own centre's pending users. SUPER_ADMIN / ADMIN see everything.
  if (
    session.role === "CENTRE_MANAGER" &&
    target.centreId !== session.centreId
  ) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (parsed.data.action === "reject") {
    await prisma.user.update({
      where: { id: target.id },
      data: { status: "suspended" },
    });
    await audit({
      userId: session.userId,
      action: "user.approval_reject",
      tableName: "user",
      rowId: target.id,
      before: { status: "pending_approval" },
      after: { status: "suspended", reason: parsed.data.reason ?? null },
    });
    // No notification — the rejected user can't sign in to see it anyway.
    return NextResponse.json({ ok: true });
  }

  // Approve path — generate + hash a temp password, flip the user to
  // active, force rotate on first sign-in. Return the temp once to the
  // caller; they share it out-of-band (WhatsApp, in person).
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.user.update({
    where: { id: target.id },
    data: {
      status: "active",
      passwordHash,
      mustChangePassword: true,
    },
  });

  await audit({
    userId: session.userId,
    action: "user.approval_approve",
    tableName: "user",
    rowId: target.id,
    before: { status: "pending_approval" },
    after: { status: "active", role: target.role, centreId: target.centreId },
  });

  // Notify the new hire — they can't log in to see this, but the row
  // appears once they sign in so they know they've been approved.
  await notify({
    userId: target.id,
    centreId: target.centreId,
    type: "user.approved",
    title: "Welcome to Equiwings",
    body: "Your account has been approved. Sign in with the temporary password the admin shared.",
    link: "/dashboard",
  });

  return NextResponse.json({ ok: true, tempPassword });
}
