// POST /api/account/email/confirm — step 2 of a self-service login-email change.
// Redeems the 6-digit code and, on success, switches User.email to the pending
// address and stamps emailVerifiedAt. Sends a heads-up to the OLD address so a
// hijacked-session change doesn't go unnoticed.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { redeemEmailChange } from "@/lib/email-verify";
import { sendEmail, renderEmail } from "@/lib/email";
import { confirmEmailChangeSchema } from "@/lib/schemas/account";

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = confirmEmailChangeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  // Snapshot the old address before the switch — needed for the heads-up email.
  const before = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, name: true },
  });

  const res = await redeemEmailChange(session.userId, parsed.data.code);
  if (!res.ok) {
    const status =
      res.error === "EMAIL_TAKEN" ? 409
      : res.error === "CODE_EXPIRED" || res.error === "TOO_MANY_ATTEMPTS" || res.error === "CODE_USED" ? 410
      : 400;
    return NextResponse.json({ error: res.error }, { status });
  }

  await audit({
    userId: session.userId,
    action: "account.email_changed",
    tableName: "user",
    rowId: session.userId,
    before: { email: before?.email },
    after: { email: res.email },
  });

  // Security heads-up to the OLD inbox. Best-effort — never blocks the change.
  if (before?.email) {
    await sendEmail({
      to: before.email,
      subject: "Your Equiwings login email was changed",
      html: renderEmail({
        centreName: "Equiwings",
        heading: "Login email changed",
        body: `<p>Hi ${escapeHtml(before.name ?? "")},</p>
<p>The login email on your Equiwings account was just changed to <b>${escapeHtml(res.email)}</b>. You'll use the new address to sign in from now on.</p>
<p>If this was you, no action is needed. If it was <b>not</b>, contact your administrator immediately — your account may be compromised.</p>`,
      }),
      ref: { type: "account.email_changed", rowId: session.userId },
    });
  }

  return NextResponse.json({ ok: true, email: res.email });
}
