// provisionTenant() — one-shot onboarding. Creates the Organisation, every
// OrgFeature row dictated by the chosen plan, the first Centre, and the first
// SUPER_ADMIN User. Returns the IDs we just created plus a one-time temp
// password the owner has to share with the new admin.
//
// Pre-flight checks (slug + email uniqueness) happen *before* the transaction
// so a user-visible 409 returns immediately rather than rolling back work.
// The catalog bootstrap (fee plans, skills, scoring templates) runs *after*
// the tx commits — it's idempotent upserts and not worth holding the tx open
// across; on the rare failure the owner can re-run via the tenant detail
// page (centres carry their own bootstrap endpoint already).

import crypto from "node:crypto";
import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { FEATURE_KEYS, type FeatureKey } from "./features";
import { planFeatures, type PlanKey } from "./plans";
import { bootstrapCentreCatalog } from "./centre-bootstrap";
import { issueEmailVerifyToken } from "./email-verify";
import { sendEmail, renderEmail } from "./email";
import type { CreateTenantInput } from "./schemas/tenant-create";

export type ProvisionTenantError = "ORG_SLUG_TAKEN" | "CENTRE_SLUG_TAKEN" | "EMAIL_TAKEN";

export type ProvisionTenantResult =
  | {
      ok: true;
      orgId: string;
      centreId: string;
      superAdminId: string;
      tempPassword: string;
    }
  | { ok: false; error: ProvisionTenantError };

export async function provisionTenant(
  input: CreateTenantInput,
  actorId?: string | null,
): Promise<ProvisionTenantResult> {
  // Uniqueness pre-flight — three independent lookups in parallel.
  const [orgDupe, centreDupe, emailDupe] = await Promise.all([
    prisma.organisation.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    prisma.centre.findUnique({ where: { slug: input.centre.slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.superAdmin.email }, select: { id: true } }),
  ]);
  if (orgDupe) return { ok: false, error: "ORG_SLUG_TAKEN" };
  if (centreDupe) return { ok: false, error: "CENTRE_SLUG_TAKEN" };
  if (emailDupe) return { ok: false, error: "EMAIL_TAKEN" };

  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const planKey = input.plan as PlanKey;
  const bundle = new Set<FeatureKey>(planFeatures(planKey));

  // One transaction for everything we *must* keep coherent: if any step fails,
  // we don't want a half-onboarded tenant.
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organisation.create({
      data: {
        slug: input.slug,
        name: input.name,
        plan: input.plan,
        status: "active",
        contactName: input.contactName?.trim() || null,
        billingEmail: input.billingEmail?.trim() || null,
        phone: input.phone?.trim() || null,
      },
    });

    await tx.orgFeature.createMany({
      data: FEATURE_KEYS.map((k) => ({
        orgId: org.id,
        featureKey: k,
        enabled: bundle.has(k),
        enabledBy: actorId ?? null,
      })),
    });

    const centre = await tx.centre.create({
      data: {
        orgId: org.id,
        slug: input.centre.slug,
        name: input.centre.name,
        address: input.centre.address?.trim() || null,
      },
    });

    const superAdmin = await tx.user.create({
      data: {
        email: input.superAdmin.email,
        name: input.superAdmin.name,
        phone: input.superAdmin.phone?.trim() || null,
        role: "SUPER_ADMIN",
        centreId: null, // HQ admin sees all centres under their org
        orgId: org.id, // Explicit org binding for HQ users.
        passwordHash,
        mustChangePassword: true,
      },
    });

    return { orgId: org.id, centreId: centre.id, superAdminId: superAdmin.id };
  });

  // Catalog bootstrap runs outside the tx — see comment at top of file.
  try {
    await bootstrapCentreCatalog(result.centreId);
  } catch (e) {
    // Logged for the owner; not fatal to onboarding. They can re-run from the
    // centre detail page once we ship the per-centre re-bootstrap UI.
    console.error("Catalog bootstrap failed for centre", result.centreId, e);
  }

  // Welcome + email-verification dispatch. Fire-and-forget — a delivery
  // failure shouldn't roll back tenant creation; the owner can request a
  // resend from the tenant detail page.
  try {
    const verifyToken = await issueEmailVerifyToken(result.superAdminId, input.superAdmin.email);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const verifyLink = `${base}/verify-email/${verifyToken}`;
    await sendEmail({
      to: input.superAdmin.email,
      subject: `Welcome to Equiwings, ${input.name}`,
      html: renderEmail({
        centreName: "Equiwings",
        heading: `Welcome aboard, ${input.superAdmin.name.split(" ")[0]}!`,
        body: `<p>Your Equiwings tenant <strong>${input.name}</strong> is live. A few next steps:</p>
<ol style="line-height:1.7;padding-left:18px">
  <li><strong>Verify your email</strong> — <a href="${verifyLink}" style="color:#0f172a">click here</a>. The link expires in 7 days.</li>
  <li><strong>Sign in</strong> at <a href="${base}/login">${base}/login</a> with the temporary password your onboarding agent shared. You'll be asked to set a permanent one immediately.</li>
  <li><strong>Invite your team</strong> from Settings → Users. Coaches, examiners, vets, accountants — each gets their own role-scoped login.</li>
  <li><strong>Add your first riders</strong> via Riders → New, or share <a href="${base}/onboarding?centre=${input.centre.slug}">your centre's signup link</a> with parents.</li>
  <li><strong>Set up your fee plans</strong> at Finance → Fee Plans so registration invoices auto-generate.</li>
</ol>
<p style="margin-top:20px"><strong>Need help?</strong> Reply to this email — we read every message.</p>`,
      }),
      ref: { type: "tenant.welcome", rowId: result.orgId },
    });
  } catch (e) {
    console.error("Welcome email failed for", result.superAdminId, e);
  }

  return { ok: true, ...result, tempPassword };
}
