import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession, hashPassword } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const issueSchema = z.object({
  email: emailIdentity(),
});

// POST /api/riders/[id]/portal-access — provision login access for a rider.
// Creates a RIDER user account, links it to the rider via Rider.userId, and
// returns a one-time temp password. Subsequent calls (e.g. lost password) go
// through /api/users/[id]/reset-password.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, userId: true, firstName: true, lastName: true },
  });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence44 = await centreFence(session, rider.centreId);
  if (fence44) {
    return NextResponse.json({ error: fence44 }, { status: 403 });
  }
  if (rider.userId) {
    return NextResponse.json({ error: "ALREADY_LINKED" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const email = parsed.data.email;

  // Email must be globally unique (User.email @unique). If it's already taken,
  // refuse rather than silently reusing the account — the manager might be
  // typing a parent's address by accident.
  const dupe = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (dupe) return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      emailVerifiedAt: new Date(), // admin-created: the admin vouches for the address
      email,
      name: `${rider.firstName} ${rider.lastName}`,
      role: "RIDER",
      centreId: rider.centreId,
      passwordHash,
      mustChangePassword: true,
    },
  });
  await prisma.rider.update({ where: { id: rider.id }, data: { userId: user.id } });

  await audit({
    userId: session.userId,
    action: "rider.portal_access_issued",
    tableName: "rider",
    rowId: rider.id,
    after: { userId: user.id, email },
  });

  return NextResponse.json({ ok: true, userId: user.id, email, tempPassword });
}

// DELETE /api/riders/[id]/portal-access — revoke rider's login.
// Unlinks from the rider (Rider.userId = null) and deletes the User row so
// the email can be re-used later. Audit records the removal.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true, userId: true },
  });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence44 = await centreFence(session, rider.centreId);
  if (fence44) {
    return NextResponse.json({ error: fence44 }, { status: 403 });
  }
  if (!rider.userId) return NextResponse.json({ error: "NOT_LINKED" }, { status: 404 });

  const userId = rider.userId;
  // Clear the link first so we don't hit FK cascade issues on delete.
  await prisma.rider.update({ where: { id: rider.id }, data: { userId: null } });
  await prisma.user.delete({ where: { id: userId } });

  await audit({
    userId: session.userId,
    action: "rider.portal_access_revoked",
    tableName: "rider",
    rowId: rider.id,
    before: { userId },
  });

  return NextResponse.json({ ok: true });
}
