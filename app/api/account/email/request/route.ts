// POST /api/account/email/request — step 1 of a self-service login-email change.
// Re-authenticates with the current password, then sends a 6-digit code to the
// NEW address. User.email is NOT touched here — the pending address lives on the
// EmailVerifyToken until /confirm redeems the code, so login keeps working on the
// old email if the change is never completed (or the new address was a typo).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { issueEmailVerifyCode } from "@/lib/email-verify";
import { sendEmail, renderEmail } from "@/lib/email";
import { checkRate } from "@/lib/rate-limit";
import { requestEmailChangeSchema } from "@/lib/schemas/account";

const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = requestEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Authenticated action, but still rate-limit per user — a live session
  // shouldn't be able to spam verification codes at an arbitrary inbox.
  if (!(await checkRate(`email-change:u:${session.userId}`, 5, 60 * 60_000)).ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, name: true, passwordHash: true },
  });
  if (!me) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Re-auth: changing a login credential requires the current password even
  // though the session is already valid (guards a hijacked/left-open session).
  if (!(await verifyPassword(parsed.data.currentPassword, me.passwordHash))) {
    return NextResponse.json({ error: "BAD_CURRENT_PASSWORD" }, { status: 401 });
  }

  const newEmail = parsed.data.newEmail.trim();
  if (newEmail.toLowerCase() === me.email.toLowerCase()) {
    return NextResponse.json({ error: "SAME_EMAIL" }, { status: 400 });
  }
  const dupe = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (dupe) return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  const code = await issueEmailVerifyCode(session.userId, newEmail);
  await sendEmail({
    to: newEmail,
    subject: "Confirm your new Equiwings login email",
    html: renderEmail({
      centreName: "Equiwings",
      heading: "Confirm your new login email",
      body: `<p>Hi ${escapeHtml(me.name)},</p>
<p>A request was made to change your Equiwings login email to <b>this address</b>. Enter the code below on the <b>My Account</b> page to confirm — it expires in 10 minutes.</p>
<p style="font-size:32px;font-weight:700;letter-spacing:0.15em;margin:20px 0;">${code}</p>
<p>Your login won't change until this code is entered. If you didn't request this, you can safely ignore this email.</p>`,
      ctaText: "Open My Account",
      ctaUrl: `${APP_BASE}/account`,
    }),
    ref: { type: "account.email_change_code", rowId: session.userId },
  });

  await audit({
    userId: session.userId,
    action: "account.email_change_requested",
    tableName: "user",
    rowId: session.userId,
    after: { newEmail },
  });

  return NextResponse.json({ ok: true });
}
