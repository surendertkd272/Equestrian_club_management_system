import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueEmailVerifyToken } from "@/lib/email-verify";
import { sendEmail, renderEmail } from "@/lib/email";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";

// Public — anyone with a known email can request a fresh link. We always
// return 200 to avoid leaking which emails exist (same pattern as
// forgot-password). Rate-limited to 3/email/hour.
const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true });

  const ip = clientFingerprint(req);
  if (!checkRate(`verify-resend:ip:${ip}`, 10, 60 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }
  if (!checkRate(`verify-resend:em:${parsed.data.email.toLowerCase()}`, 3, 60 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, status: true },
  });
  // Don't tell the caller anything — just 200 either way.
  if (!user || user.status !== "active" || user.emailVerifiedAt) {
    return NextResponse.json({ ok: true });
  }

  const token = await issueEmailVerifyToken(user.id, user.email);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${base}/verify-email/${token}`;

  await sendEmail({
    to: user.email,
    subject: "Verify your Equiwings email",
    html: renderEmail({
      centreName: "Equiwings",
      heading: "Verify your email",
      body: `<p>Hi ${user.name},</p>
<p>Click the button below to confirm your email address. The link expires in 7 days.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none">Verify email</a></p>
<p style="font-size:12px;color:#666">Or paste this URL: <code>${link}</code></p>`,
    }),
    ref: { type: "auth.email_verify_link", rowId: user.id },
  });

  return NextResponse.json({ ok: true });
}
