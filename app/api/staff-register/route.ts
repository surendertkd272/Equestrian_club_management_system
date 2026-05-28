// Public staff registration endpoint — receives a /staff-register/[code]
// submission, validates the code, and creates a User row in
// `pending_approval` status. Admin reviews via /users (filter status =
// pending_approval) and flips the status to active. No password is set
// until approval, at which point a one-time temp pwd is emailed.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMany } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";

const schema = z.object({
  code: z.string().min(4).max(16),
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  role: z.enum([
    "COACH", "GROOM", "STABLE_MANAGER", "INVENTORY_MANAGER",
    "VET", "FARRIER", "ACCOUNTANT", "COMPETITION_MANAGER",
  ]),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  // Public invite redemption. The short code is a secret, but rate-limit
  // anyway: a leaked code without a per-IP cap lets an attacker race the
  // legitimate invitee to single-use redemption, and unbounded retries
  // against an *invalid* code probe for valid ones via timing. 20/hour/IP
  // covers the normal "I mistyped, retry" loop with room to spare.
  const rl = checkRate(`staff-register:${clientFingerprint(req)}`, 20, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Validate the invite code — must be a staff_hire short link, still valid.
  const code = parsed.data.code.toUpperCase();
  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) return NextResponse.json({ error: "INVITE_NOT_FOUND" }, { status: 404 });
  if (link.kind !== "staff_hire") {
    return NextResponse.json({ error: "INVITE_WRONG_KIND" }, { status: 400 });
  }
  if (link.expiresAt && link.expiresAt < new Date()) {
    return NextResponse.json({ error: "INVITE_EXPIRED" }, { status: 400 });
  }
  // Single-use invites die after the first successful signup.
  if (link.singleUse && link.redeemCount > 0) {
    return NextResponse.json({ error: "INVITE_ALREADY_USED" }, { status: 410 });
  }

  // Email lock — if the invite was issued for a specific person, the
  // submitted email must match. Stops a forwarded link being used by
  // someone else.
  let invitedEmail: string | null = null;
  let invitedRole: string | null = null;
  // paramsJson is a jsonb column — Prisma returns the parsed object.
  if (link.paramsJson && typeof link.paramsJson === "object" && !Array.isArray(link.paramsJson)) {
    const p = link.paramsJson as Record<string, unknown>;
    invitedEmail = typeof p.email === "string" ? p.email.toLowerCase() : null;
    invitedRole = typeof p.role === "string" ? p.role : null;
  }
  if (invitedEmail && parsed.data.email.toLowerCase() !== invitedEmail) {
    return NextResponse.json(
      { error: "EMAIL_MISMATCH", message: "This invite is locked to a different email address." },
      { status: 403 },
    );
  }
  // Lock the role to the invited one when set (the form sends it, but never trust the client).
  const effectiveRole = invitedRole ?? parsed.data.role;

  // Email uniqueness — reject if someone with this email already exists.
  // (Avoids creating a duplicate ghost user via the invite path.)
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_IN_USE", message: "An account with this email already exists. Ask the admin to add you to this centre instead." }, { status: 409 });
  }

  // Create the pending user. No password yet — set when admin approves.
  // Stash the optional notes + invite code in `notifPrefsJson` as a JSON
  // blob so we don't need a separate StaffInvite table for the audit info.
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      role: effectiveRole,
      centreId: link.centreId,
      passwordHash: "PENDING", // placeholder; admin resets on approval
      status: "pending_approval",
      notifPrefsJson: JSON.stringify({
        inviteCode: code,
        inviteNotes: parsed.data.notes ?? null,
      }),
    },
  });

  // Bump the link redemption counter so admins can see "this invite has
  // been used N times".
  await prisma.shortLink
    .update({
      where: { id: link.id },
      data: { redeemCount: { increment: 1 }, lastRedeemedAt: new Date() },
    })
    .catch(() => null);

  await audit({
    userId: user.id,
    action: "user.register_pending",
    tableName: "user",
    rowId: user.id,
    after: { email: user.email, role: user.role, centreId: link.centreId, viaInvite: code },
  });

  // Notify centre manager + HQ admins so the approval doesn't sit idle.
  const approvers = await prisma.user.findMany({
    where: {
      OR: [
        { centreId: link.centreId, role: { in: ["CENTRE_MANAGER", "HEAD_COACH"] } },
        { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
      ],
      status: "active",
    },
    select: { id: true },
  });
  await notifyMany(approvers.map((u) => u.id), {
    centreId: link.centreId,
    type: "user.pending_approval",
    title: "New staff signup awaiting approval",
    body: `${user.name} (${user.role.replaceAll("_", " ").toLowerCase()}) registered via your invite link. Review at /users.`,
    link: "/users?status=pending_approval",
  });

  return NextResponse.json({ ok: true });
}
