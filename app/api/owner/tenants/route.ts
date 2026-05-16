import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { TENANT_STATUSES } from "@/lib/schemas/tenant";
import { createTenantSchema } from "@/lib/schemas/tenant-create";
import { provisionTenant } from "@/lib/tenant-provision";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";

// GET /api/owner/tenants — list tenants for the owner portal table. Optional
// filters: ?q=<name|slug substring>, ?status=<status>, ?plan=<starter|pro|enterprise>.
export async function GET(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status");
  const plan = searchParams.get("plan");

  const where: any = {};
  if (q) {
    // SQLite has no `mode: insensitive`, so we OR substring matches against
    // the raw casing. Slugs + emails are already lowercase; names mixed-case.
    where.OR = [
      { name: { contains: q } },
      { slug: { contains: q.toLowerCase() } },
      { billingEmail: { contains: q.toLowerCase() } },
      { contactName: { contains: q } },
    ];
  }
  if (status && (TENANT_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if (plan && ["starter", "pro", "enterprise"].includes(plan)) {
    where.plan = plan;
  }

  const tenants = await prisma.organisation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      plan: true,
      status: true,
      contactName: true,
      billingEmail: true,
      onboardedAt: true,
      createdAt: true,
      _count: { select: { centres: true } },
    },
  });

  // Rider count needs a separate aggregation — Rider hangs off Centre, not
  // Organisation, so the include path would be expensive.
  const orgIds = tenants.map((t) => t.id);
  const riderCounts = orgIds.length
    ? await prisma.rider.groupBy({
        by: ["centreId"],
        where: { centre: { orgId: { in: orgIds } } },
        _count: { _all: true },
      })
    : [];
  const centreToOrg = orgIds.length
    ? new Map(
        (await prisma.centre.findMany({
          where: { orgId: { in: orgIds } },
          select: { id: true, orgId: true },
        })).map((c) => [c.id, c.orgId]),
      )
    : new Map<string, string>();
  const ridersByOrg = new Map<string, number>();
  for (const row of riderCounts) {
    const orgId = centreToOrg.get(row.centreId);
    if (!orgId) continue;
    ridersByOrg.set(orgId, (ridersByOrg.get(orgId) ?? 0) + row._count._all);
  }

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      status: t.status,
      contactName: t.contactName,
      billingEmail: t.billingEmail,
      onboardedAt: t.onboardedAt,
      createdAt: t.createdAt,
      centresCount: t._count.centres,
      ridersCount: ridersByOrg.get(t.id) ?? 0,
    })),
  });
}

// POST /api/owner/tenants — full 3-step onboarding in one shot. Creates the
// org + first centre + first SUPER_ADMIN inside one transaction, seeds
// OrgFeature rows from the chosen plan, bootstraps the centre's catalog, and
// returns a one-time temp password the owner must hand to the new admin.
export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.create");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await provisionTenant(parsed.data, session.ownerId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.tenant_provisioned",
    orgId: result.orgId,
    after: {
      slug: parsed.data.slug,
      plan: parsed.data.plan,
      centreSlug: parsed.data.centre.slug,
      superAdminEmail: parsed.data.superAdmin.email,
    },
  });

  return NextResponse.json({
    ok: true,
    orgId: result.orgId,
    centreId: result.centreId,
    superAdminId: result.superAdminId,
    superAdminEmail: parsed.data.superAdmin.email,
    tempPassword: result.tempPassword,
  });
}
