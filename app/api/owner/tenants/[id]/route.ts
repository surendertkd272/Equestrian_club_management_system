import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { updateTenantSchema } from "@/lib/schemas/tenant";
import { ownerCan } from "@/lib/owner-permissions";

// GET /api/owner/tenants/[id] — full detail used by the owner detail page.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const tenant = await prisma.organisation.findUnique({
    where: { id: params.id },
    include: {
      centres: {
        select: {
          id: true,
          slug: true,
          name: true,
          address: true,
          _count: { select: { users: true, riders: true, horses: true } },
        },
        orderBy: { name: "asc" },
      },
      features: {
        select: { featureKey: true, enabled: true },
        orderBy: { featureKey: "asc" },
      },
    },
  });
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Super admins (the tenant's HQ logins) — useful at-a-glance on the detail page.
  const centreIds = tenant.centres.map((c) => c.id);
  const [superAdmins, userCount, riderCount] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: "SUPER_ADMIN",
        OR: [{ centreId: null }, { centreId: { in: centreIds } }],
      },
      select: { id: true, name: true, email: true, status: true },
    }),
    prisma.user.count({ where: { centreId: { in: centreIds } } }),
    prisma.rider.count({ where: { centreId: { in: centreIds } } }),
  ]);

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      contactName: tenant.contactName,
      billingEmail: tenant.billingEmail,
      phone: tenant.phone,
      trialEndsAt: tenant.trialEndsAt,
      onboardedAt: tenant.onboardedAt,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      stripeCustomerId: tenant.stripeCustomerId,
      subscriptionStatus: tenant.subscriptionStatus,
      currentPeriodEnd: tenant.currentPeriodEnd,
      centres: tenant.centres,
      features: tenant.features,
      stats: { userCount, riderCount, centreCount: tenant.centres.length },
      superAdmins,
    },
  });
}

// PATCH /api/owner/tenants/[id] — edit name, contact info, billing, status.
// Plan changes are gated to Phase 4 (they have to reseed OrgFeature in a tx).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  // Field-by-field permission check: an editor can rename a tenant but can't
  // touch billing; a billing user can flip status but can't rename. Each field
  // family maps to its own permission, so the caller gets a specific FORBIDDEN.
  const wantsMetadata =
    parsed.data.name !== undefined ||
    parsed.data.contactName !== undefined ||
    parsed.data.phone !== undefined;
  const wantsBilling = parsed.data.billingEmail !== undefined;
  const wantsStatus = parsed.data.status !== undefined;

  if (wantsMetadata && !ownerCan(session.role, "tenant.edit_metadata")) {
    return NextResponse.json({ error: "FORBIDDEN", required: "tenant.edit_metadata" }, { status: 403 });
  }
  if (wantsBilling && !ownerCan(session.role, "tenant.edit_billing")) {
    return NextResponse.json({ error: "FORBIDDEN", required: "tenant.edit_billing" }, { status: 403 });
  }
  if (wantsStatus && !ownerCan(session.role, "tenant.change_status")) {
    return NextResponse.json({ error: "FORBIDDEN", required: "tenant.change_status" }, { status: 403 });
  }

  const before = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      contactName: true,
      billingEmail: true,
      phone: true,
      status: true,
    },
  });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.contactName !== undefined) data.contactName = parsed.data.contactName || null;
  if (parsed.data.billingEmail !== undefined) data.billingEmail = parsed.data.billingEmail || null;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  const after = await prisma.organisation.update({ where: { id: params.id }, data });

  await auditOwner({
    actorId: session.ownerId,
    action: parsed.data.status && parsed.data.status !== before.status
      ? "owner.tenant_status_changed"
      : "owner.tenant_updated",
    orgId: after.id,
    before,
    after: {
      name: after.name,
      contactName: after.contactName,
      billingEmail: after.billingEmail,
      phone: after.phone,
      status: after.status,
    },
  });

  return NextResponse.json({ ok: true });
}
