import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { externalEntrySchema } from "@/lib/schemas/external-entry";
import { newEntryToken } from "@/lib/external-entry-token";
import { verifyChallenge } from "@/lib/captcha";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { sendEmail, renderEmail } from "@/lib/email";
import { ageYears } from "@/lib/schemas/rider-onboarding";

// POST /api/public/competitions/[slug]/entries — public entry submission
// from a visiting rider. We:
//   1. Verify CAPTCHA + rate-limit (per IP).
//   2. Validate the form schema.
//   3. Check the competition exists + is open for entries.
//   4. Check the class exists + has capacity.
//   5. Validate parental consent if the rider is under 18.
//   6. For state/national scope, require accreditation fields.
//   7. Persist as ExternalEntry (status=pending, verifiedAt=null).
//   8. Email a magic-link verifying the email is real.
//
// Approval is a separate step by the organiser. The public response
// always succeeds (privacy: don't leak which classes are full).
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  // Rate limit per IP — abusive bots can flood otherwise.
  const ip = clientFingerprint(req);
  const rl = checkRate(`public-entry:${ip}`, 10, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: true, message: "Submitted. Check your email." });
  }

  const body = await req.json().catch(() => null);
  const parsed = externalEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (!verifyChallenge(d.captchaToken, d.captchaAnswer)) {
    return NextResponse.json({ error: "CAPTCHA_FAILED" }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      classesJson: true,
      status: true,
      scope: true,
      entryDeadline: true,
      name: true,
      centre: { select: { name: true } },
    },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (comp.status !== "open_for_entries") {
    return NextResponse.json({ error: "ENTRIES_CLOSED" }, { status: 409 });
  }
  if (comp.entryDeadline && comp.entryDeadline < new Date()) {
    return NextResponse.json({ error: "DEADLINE_PASSED" }, { status: 409 });
  }

  // classesJson is a jsonb column — already parsed by Prisma. Bad shape
  // (shouldn't happen but legacy rows might) → bail with a 500 so the entrant
  // gets a clear error instead of an unhandled crash.
  const classes: Array<{ name: string; fee?: number; maxEntries?: number }> = Array.isArray(comp.classesJson)
    ? (comp.classesJson as Array<{ name: string; fee?: number; maxEntries?: number }>)
    : [];
  if (classes.length === 0) {
    return NextResponse.json({ error: "CONFIG_ERROR" }, { status: 500 });
  }
  const cls = classes.find((c) => c.name === d.className);
  if (!cls) return NextResponse.json({ error: "UNKNOWN_CLASS" }, { status: 400 });

  // Federation eligibility for state/national scope.
  if ((comp.scope === "state" || comp.scope === "national") && !d.accreditationNumber) {
    return NextResponse.json(
      { error: "ACCREDITATION_REQUIRED", message: `${comp.scope} scope requires a federation accreditation number.` },
      { status: 400 },
    );
  }

  // DPDPA parental consent for under-18 — same gate as internal onboarding.
  if (d.dob) {
    const isMinor = ageYears(new Date(d.dob)) < 18;
    if (isMinor) {
      const missing: string[] = [];
      if (!d.parentName) missing.push("parentName");
      if (!d.parentRelation) missing.push("parentRelation");
      if (!d.parentPhone) missing.push("parentPhone");
      if (d.parentConsentAgreed !== true) missing.push("parentConsentAgreed");
      if (missing.length > 0) {
        return NextResponse.json(
          { error: "PARENTAL_CONSENT_REQUIRED", missing },
          { status: 400 },
        );
      }
    }
  }

  // Mint the verify token + persist.
  const { plain, hash, expiresAt } = newEntryToken();
  const entry = await prisma.externalEntry.create({
    data: {
      competitionId: comp.id,
      className: d.className,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email.toLowerCase(),
      mobile: d.mobile,
      dob: d.dob ? new Date(d.dob) : null,
      parentName: d.parentName || null,
      parentRelation: d.parentRelation ?? null,
      parentPhone: d.parentPhone || null,
      accreditationBody: d.accreditationBody || null,
      accreditationNumber: d.accreditationNumber || null,
      accreditationExpiry: d.accreditationExpiry ? new Date(d.accreditationExpiry) : null,
      horseName: d.horseName || null,
      horseBreed: d.horseBreed || null,
      horseHeightHh: d.horseHeightHh ?? null,
      verifyTokenHash: hash,
      verifyExpiresAt: expiresAt,
    },
  });

  // Magic-link verification email.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${base}/compete/${params.slug}/verify/${plain}`;
  await sendEmail({
    to: d.email,
    subject: `Confirm your entry to ${comp.name}`,
    html: renderEmail({
      centreName: comp.centre.name,
      heading: "Confirm your competition entry",
      body: `<p>Hi ${d.firstName},</p>
<p>Click the link below to confirm your entry to <strong>${comp.name}</strong> in the <strong>${d.className}</strong> class. The link expires in 48 hours.</p>
<p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none">Confirm entry</a></p>
<p style="font-size:12px;color:#666">If the button doesn't work, paste this URL: <code>${verifyUrl}</code></p>
<p style="font-size:12px;color:#666">After you confirm, the organiser will review and approve. You'll get a second email when your entry is on the start list.</p>`,
    }),
    ref: { type: "competition.external_entry_verify", rowId: entry.id },
  });

  return NextResponse.json({ ok: true, message: "Submitted. Check your email to confirm." });
}
