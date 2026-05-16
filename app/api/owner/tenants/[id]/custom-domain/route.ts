import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { invalidateDomainCache } from "@/lib/custom-domain";

// Lowercase hostname per RFC 1035 + a forgiving cap. We don't enforce
// resolveable DNS — that's the customer's job — but we do reject obvious
// nonsense like "spaces in here".
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const schema = z
  .object({
    customDomain: z
      .string()
      .max(253)
      .nullable()
      .refine((v) => v === null || v === "" || DOMAIN_RE.test(v.toLowerCase()), {
        message: "must be a fully-qualified hostname (e.g. app.example.com)",
      }),
    // Owner toggles "verified" themselves after they've checked DNS+SSL.
    // For now we don't auto-verify; that needs hosting-provider integration.
    verified: z.boolean().optional(),
  })
  .strict();

// PATCH /api/owner/tenants/[id]/custom-domain — set, clear, or mark verified.
// Permission: tenant.edit_billing (the same scope that handles other
// provisioning concerns — admins and billing operators).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, customDomain: true, customDomainVerifiedAt: true },
  });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const nextDomain = parsed.data.customDomain ? parsed.data.customDomain.toLowerCase() : null;

  // Uniqueness: refuse if another tenant has already claimed this hostname.
  if (nextDomain) {
    const dupe = await prisma.organisation.findFirst({
      where: { customDomain: nextDomain, NOT: { id: before.id } },
      select: { slug: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "DOMAIN_ALREADY_CLAIMED", details: { orgSlug: dupe.slug } },
        { status: 409 },
      );
    }
  }

  // When the domain changes, the verified timestamp resets — the customer
  // has to re-verify after pointing DNS. Owner can also explicitly mark
  // verified=true via the body once DNS+SSL look right.
  let verifiedAt: Date | null = before.customDomainVerifiedAt;
  if (nextDomain !== before.customDomain) {
    verifiedAt = null;
  }
  if (parsed.data.verified === true && nextDomain) {
    verifiedAt = new Date();
  } else if (parsed.data.verified === false) {
    verifiedAt = null;
  }

  await prisma.organisation.update({
    where: { id: before.id },
    data: {
      customDomain: nextDomain,
      customDomainVerifiedAt: verifiedAt,
    },
  });

  // Evict both the previous and new hostnames from the resolver cache so
  // the next inbound request picks up the change immediately instead of
  // waiting for TTL_MS. Without this, a freshly-unlinked domain would keep
  // routing to the old tenant for up to 60s.
  invalidateDomainCache([before.customDomain, nextDomain]);

  await auditOwner({
    actorId: session.ownerId,
    action: nextDomain ? "owner.custom_domain_set" : "owner.custom_domain_cleared",
    orgId: before.id,
    before: {
      customDomain: before.customDomain,
      customDomainVerifiedAt: before.customDomainVerifiedAt,
    },
    after: { customDomain: nextDomain, customDomainVerifiedAt: verifiedAt },
  });

  return NextResponse.json({ ok: true, customDomain: nextDomain, verifiedAt });
}
