import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueOwnerResetToken } from "@/lib/owner-password-reset";
import { sendEmail, renderEmail } from "@/lib/email";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email() });

// Public — always returns 200 to avoid enumerating the owner team.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true });

  // Tighter throttle than tenant forgot — owner team is a much smaller set.
  const ip = clientFingerprint(req);
  if (!checkRate(`owner-forgot:ip:${ip}`, 3, 60 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }
  if (!checkRate(`owner-forgot:em:${parsed.data.email.toLowerCase()}`, 2, 60 * 60_000).ok) {
    return NextResponse.json({ ok: true });
  }

  const owner = await prisma.platformUser.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true, status: true },
  });
  if (!owner || owner.status !== "active") return NextResponse.json({ ok: true });

  const forwardedFor = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const token = await issueOwnerResetToken(owner.id, forwardedFor);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/owner/reset-password/${token}`;

  await sendEmail({
    to: owner.email,
    subject: "Reset your Equiwings owner password",
    html: renderEmail({
      centreName: "Equiwings Platform",
      heading: "Reset your owner password",
      body: `<p>Hi ${owner.name},</p>
<p>A password reset was requested for the platform-owner console.</p>
<p>The link below expires in 30 minutes and is single-use.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none">Set new password</a></p>
<p style="font-size:12px;color:#666">Didn't request this? Ignore the email — the link expires on its own.</p>`,
    }),
    ref: { type: "owner.password.reset_link", rowId: owner.id },
  });

  return NextResponse.json({ ok: true });
}
