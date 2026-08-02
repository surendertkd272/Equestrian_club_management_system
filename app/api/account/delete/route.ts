import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, clearSessionCookie, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { deletionScheduledFor } from "@/lib/dpdpa";
import { sendEmail, renderEmail } from "@/lib/email";

// POST /api/account/delete — DPDPA Section 12 right-to-erasure.
//
// Two-step model: this call marks the account for deletion + sets a
// 30-day grace window during which the user can cancel via /cancel.
// On expiry, the sweep at lib/sweeps.ts:sweepDpdpaDeletions hard-deletes
// the user row + their personal records. We deliberately do NOT delete
// immediately so an attacker who steals a cookie can't permanently
// destroy data — the email notification gives the legitimate owner a
// chance to react.
//
// Audit-log rows are kept (anonymised) to preserve the financial trail;
// regulators require we can prove a transaction happened even after the
// actor is gone.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, deletionRequestedAt: true, passwordHash: true },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Step-up re-authentication. Scheduling an erasure is the most destructive
  // thing an account can do to itself, and it used to need nothing but a valid
  // cookie — so a session lifted off a shared machine could queue the owner's
  // account for deletion. Re-prove the password, the same bar
  // /api/account/change-password and the email-change flow already set.
  const body = await req.json().catch(() => null);
  const parsed = z.object({ currentPassword: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "PASSWORD_REQUIRED" }, { status: 400 });
  }
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "BAD_CURRENT_PASSWORD" }, { status: 401 });
  }
  if (user.deletionRequestedAt) {
    return NextResponse.json(
      { error: "ALREADY_REQUESTED", scheduledFor: deletionScheduledFor(user.deletionRequestedAt) },
      { status: 409 },
    );
  }

  const requestedAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: requestedAt, tokenVersion: { increment: 1 } },
  });

  await audit({
    userId: user.id,
    action: "account.deletion_requested",
    tableName: "user",
    rowId: user.id,
    after: { requestedAt },
  });

  // Plain-language confirmation email — DPDPA expects the data principal
  // to be informed of the request. We also state the grace deadline so
  // there is no ambiguity about when the data goes.
  await sendEmail({
    to: user.email,
    subject: "Account deletion requested",
    html: renderEmail({
      centreName: "Equiwings",
      heading: "We received your account deletion request",
      body: `<p>Hi ${user.name},</p>
<p>Your Equiwings account will be permanently deleted on
<b>${deletionScheduledFor(requestedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</b>.</p>
<p>If you change your mind, go to the sign-in page and enter your usual email and password any time before that date — we'll offer you a "Keep my account" button instead of signing you in. After deletion, we cannot restore your data.</p>
<p>Some records (paid invoices, certificates issued, audit-trail entries) are retained in an anonymised form because Indian tax and financial-services regulations require us to. These records no longer carry your name, email, or phone number.</p>`,
    }),
    ref: { type: "account.deletion_requested", rowId: user.id },
  });

  // Kill the live session — the bumped tokenVersion in the update above
  // invalidates the JWT, but clearing the cookie gives an immediate UX cue.
  await clearSessionCookie();

  return NextResponse.json({
    ok: true,
    scheduledFor: deletionScheduledFor(requestedAt),
  });
}

// POST /api/account/delete/cancel — withdraw a pending deletion request.
// Handled in the sibling cancel/route.ts file.
