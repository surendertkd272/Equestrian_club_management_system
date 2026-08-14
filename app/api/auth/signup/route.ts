import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { emailIdentity } from "@/lib/email-normalize";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { verifyChallenge } from "@/lib/captcha";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { provisionTenant } from "@/lib/tenant-provision";
import { uniqueSlug } from "@/lib/slugify";
import { bindRlsBypass } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { notifyOwner, esc } from "@/lib/notify-owner";

// POST /api/auth/signup — public self-serve club registration.
//
// This creates an Organisation and a SUPER_ADMIN: the highest-privilege object
// in the system, from an unauthenticated request. The guards are the point.
//
//   • CAPTCHA, enforced in production (the same challenge the forgot-password
//     flow uses, which now actually renders).
//   • Two-axis durable rate limiting, so a script can't mint orgs in a loop.
//   • Email verification gates FIRST USE, not signup: provisionTenant emails a
//     code, and accountStateGate() refuses the sign-in until it is entered. So
//     a bogus address produces an org nobody can ever log into, rather than a
//     working account.
//   • The new admin is SUPER_ADMIN of their OWN org only — org scoping and the
//     RLS backstop confine them to it.
//
// Deliberately NOT signed in on success. Verifying the address is the whole
// abuse control; handing out a session first would skip it.
const schema = z.object({
  clubName: z.string().min(2).max(150),
  adminName: z.string().min(2).max(120),
  email: emailIdentity(),
  password: z.string().min(8).max(200),
  phone: z.string().max(40).optional(),
  captchaToken: z.string().optional(),
  captchaAnswer: z.string().optional(),
});

// Trial length. Mirrors the {{14}} in the terms page — keep the two in step if
// either changes.
const TRIAL_DAYS = 14;

export async function POST(req: NextRequest) {
  // No session to bind an org from; provisioning is cross-org by nature.
  bindRlsBypass();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const ip = clientFingerprint(req);
  for (const [key, limit, windowMs] of [
    [`signup:ip:${ip}`, 5, 60 * 60_000],
    [`signup:em:${d.email}`, 3, 60 * 60_000],
  ] as const) {
    const check = await checkRate(key, limit, windowMs);
    if (!check.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSec: check.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } },
      );
    }
  }

  if (process.env.NODE_ENV === "production") {
    if (!d.captchaToken || !d.captchaAnswer || !verifyChallenge(d.captchaToken, d.captchaAnswer)) {
      return NextResponse.json(
        { error: "CAPTCHA_FAILED", message: "That verification answer wasn't right — try the new question." },
        { status: 400 },
      );
    }
  }

  const policy = checkPasswordPolicy(d.password);
  if (!policy.ok) {
    return NextResponse.json({ error: "WEAK_PASSWORD", message: policy.reason }, { status: 400 });
  }

  // Answer the same way whether or not the address is already registered, so
  // this endpoint can't be used to enumerate customers. The real owner gets an
  // email telling them someone tried; nobody else learns anything.
  const existing = await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } });
  if (existing) {
    await audit({
      action: "tenant.signup_duplicate_email",
      tableName: "user",
      rowId: existing.id,
      after: { email: d.email },
      ip,
    });
    return NextResponse.json({ ok: true, pendingVerification: true });
  }

  // Derive both slugs from the club name — see lib/slugify.ts for why we don't
  // ask. Collisions get a numeric suffix rather than an error the signer-up
  // has no way to resolve.
  const orgSlug = await uniqueSlug(d.clubName, async (s) =>
    Boolean(await prisma.organisation.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  const centreSlug = await uniqueSlug(d.clubName, async (s) =>
    Boolean(await prisma.centre.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  if (!orgSlug || !centreSlug) {
    return NextResponse.json(
      { error: "NAME_UNAVAILABLE", message: "We couldn't create a web address from that name — please try a different club name." },
      { status: 409 },
    );
  }

  const result = await provisionTenant(
    {
      name: d.clubName,
      slug: orgSlug,
      plan: "starter",
      contactName: d.adminName,
      billingEmail: d.email,
      phone: d.phone,
      centre: { name: d.clubName, slug: centreSlug },
      superAdmin: { name: d.adminName, email: d.email, phone: d.phone },
    },
    null,
    { password: d.password, status: "trial", trialDays: TRIAL_DAYS },
  );

  if (!result.ok) {
    // Slugs were just checked, so a collision here means a concurrent signup
    // took the name between the check and the insert.
    const status = result.error === "EMAIL_TAKEN" ? 200 : 409;
    if (status === 200) return NextResponse.json({ ok: true, pendingVerification: true });
    return NextResponse.json(
      { error: result.error, message: "That name was just taken — please try a slightly different one." },
      { status },
    );
  }

  await audit({
    userId: result.superAdminId,
    action: "tenant.self_signup",
    tableName: "organisation",
    rowId: result.orgId,
    after: { slug: orgSlug, plan: "starter", trialDays: TRIAL_DAYS },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  // Tell the owner a club arrived. With self-serve live this is the only
  // signal a lead exists at all -- and it is also the abuse tripwire: a burst
  // of these is what a spam run looks like. Deliberately after the audit write
  // and never awaited into the failure path, so a mail problem cannot fail a
  // signup that already succeeded.
  await notifyOwner({
    subject: `New club signed up — ${d.clubName}`,
    heading: "A club just signed up",
    body: `<p><strong>${esc(d.clubName)}</strong> registered and started a ${TRIAL_DAYS}-day trial.</p>
<ul>
  <li>Administrator: ${esc(d.adminName)} &lt;${esc(d.email)}&gt;</li>
  <li>Web address: <code>${esc(orgSlug)}</code></li>
  <li>Plan: starter (trial)</li>
</ul>
<p>They have not confirmed their email address yet, so they cannot sign in until
they enter the code. If that never happens, the account stays dormant and can be
ignored.</p>`,
    ref: { type: "owner.tenant_signup", rowId: result.orgId },
  });

  return NextResponse.json({ ok: true, pendingVerification: true });
}
