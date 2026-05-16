import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { TenantsClient } from "./tenants-client";

export const dynamic = "force-dynamic";

export default async function TenantsListPage() {
  // SSR the first page so the table is populated on first paint; client-side
  // filtering re-fetches via /api/owner/tenants when filters change.
  const tenants = await prisma.organisation.findMany({
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
      _count: { select: { centres: true } },
    },
  });

  const orgIds = tenants.map((t) => t.id);
  const centres = orgIds.length
    ? await prisma.centre.findMany({
        where: { orgId: { in: orgIds } },
        select: { id: true, orgId: true },
      })
    : [];
  const centreToOrg = new Map(centres.map((c) => [c.id, c.orgId]));
  const riderCounts = orgIds.length
    ? await prisma.rider.groupBy({
        by: ["centreId"],
        where: { centre: { orgId: { in: orgIds } } },
        _count: { _all: true },
      })
    : [];
  const ridersByOrg = new Map<string, number>();
  for (const row of riderCounts) {
    const orgId = centreToOrg.get(row.centreId);
    if (!orgId) continue;
    ridersByOrg.set(orgId, (ridersByOrg.get(orgId) ?? 0) + row._count._all);
  }

  const initial = tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    plan: t.plan,
    status: t.status,
    contactName: t.contactName,
    billingEmail: t.billingEmail,
    onboardedAt: t.onboardedAt.toISOString(),
    centresCount: t._count.centres,
    ridersCount: ridersByOrg.get(t.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="text-sm text-slate-400">
            {initial.length} tenant{initial.length === 1 ? "" : "s"} onboarded.
          </p>
        </div>
        <Link
          href="/owner/tenants/new"
          className="inline-flex h-10 items-center rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-900 hover:bg-white"
        >
          + New tenant
        </Link>
      </div>

      <TenantsClient initial={initial} />
    </div>
  );
}
