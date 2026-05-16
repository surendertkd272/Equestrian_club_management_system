import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PlanBadge, StatusBadge } from "../../badges";
import { TenantEditForm } from "./edit-form";
import { PlanChange } from "./plan-change";
import { FeatureMatrix } from "./feature-matrix";
import { BillingPanel } from "./billing-panel";
import { RazorpayPanel } from "./razorpay-panel";
import { CustomDomainPanel } from "./custom-domain-panel";
import { OffboardPanel } from "./offboard-panel";
import { ImpersonateButton } from "./impersonate-button";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features";
import { isPlanKey, PLAN_REGISTRY, planAllowsOverrides, type PlanKey } from "@/lib/plans";
import { getOwnerSession } from "@/lib/owner-auth";
import { ownerCan } from "@/lib/owner-permissions";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: { id: string } }) {
  const ownerSession = await getOwnerSession();
  const canBilling = ownerSession ? ownerCan(ownerSession.role, "tenant.edit_billing") : false;
  // Impersonation is OWNER_ADMIN only — the most sensitive action in the owner
  // portal. Lower-privilege owner roles see no "Sign in as" button.
  const canImpersonate = ownerSession?.role === "OWNER_ADMIN";
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
      features: { select: { featureKey: true, enabled: true }, orderBy: { featureKey: "asc" } },
    },
  });
  if (!tenant) notFound();

  const centreIds = tenant.centres.map((c) => c.id);
  const [userCount, riderCount, superAdmins] = await Promise.all([
    prisma.user.count({ where: { centreId: { in: centreIds } } }),
    prisma.rider.count({ where: { centreId: { in: centreIds } } }),
    prisma.user.findMany({
      where: {
        role: "SUPER_ADMIN",
        OR: [{ centreId: null }, { centreId: { in: centreIds } }],
      },
      select: { id: true, name: true, email: true, status: true },
    }),
  ]);

  const enabledFeatures = tenant.features.filter((f) => f.enabled).length;

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs text-slate-500">
          <Link href="/owner/tenants" className="hover:underline">Tenants</Link>
          <span className="mx-1">/</span>
          <span>{tenant.name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <PlanBadge plan={tenant.plan} />
          <StatusBadge status={tenant.status} />
          <span className="font-mono text-xs text-slate-500">{tenant.slug}</span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Onboarded {new Date(tenant.onboardedAt).toLocaleDateString()} · Last updated{" "}
          {new Date(tenant.updatedAt).toLocaleDateString()}
          {" · "}
          <Link href={`/owner/tenants/${tenant.id}/activity`} className="text-emerald-400 hover:underline">
            View activity timeline →
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Centres" value={tenant.centres.length} />
        <Stat label="Users" value={userCount} />
        <Stat label="Riders" value={riderCount} />
        <Stat label="Features on" value={`${enabledFeatures} / ${tenant.features.length}`} />
      </div>

      <Panel title="Edit tenant">
        <TenantEditForm
          id={tenant.id}
          initial={{
            name: tenant.name,
            contactName: tenant.contactName ?? "",
            billingEmail: tenant.billingEmail ?? "",
            phone: tenant.phone ?? "",
            status: tenant.status,
          }}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Centres">
          {tenant.centres.length === 0 ? (
            <div className="text-sm text-slate-500">No centres yet.</div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {tenant.centres.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{c.slug}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {c._count.users} users · {c._count.riders} riders · {c._count.horses} horses
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="HQ super admins">
          {superAdmins.length === 0 ? (
            <div className="text-sm text-slate-500">No super admins yet.</div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {superAdmins.map((u) => (
                <li key={u.id} className="flex items-start justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                    {u.status !== "active" && (
                      <div className="text-xs text-rose-400">{u.status}</div>
                    )}
                  </div>
                  {u.status === "active" && (
                    <ImpersonateButton
                      tenantId={tenant.id}
                      userId={u.id}
                      userName={u.name}
                      canImpersonate={canImpersonate}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Billing · Stripe">
        <BillingPanel
          tenantId={tenant.id}
          canManage={canBilling}
          initial={{
            stripeCustomerId: tenant.stripeCustomerId,
            subscriptionStatus: tenant.subscriptionStatus,
            currentPeriodEnd: tenant.currentPeriodEnd ? tenant.currentPeriodEnd.toISOString() : null,
          }}
        />
      </Panel>

      <Panel title="Billing · Razorpay (India)">
        <RazorpayPanel
          tenantId={tenant.id}
          canManage={canBilling}
          initial={{
            razorpaySubscriptionId: tenant.razorpaySubscriptionId,
            razorpaySubscriptionStatus: tenant.razorpaySubscriptionStatus,
            plan: tenant.plan,
          }}
        />
      </Panel>

      <Panel title="Custom domain">
        <CustomDomainPanel
          tenantId={tenant.id}
          tenantSlug={tenant.slug}
          canManage={canBilling}
          initial={{
            customDomain: tenant.customDomain,
            customDomainVerifiedAt: tenant.customDomainVerifiedAt
              ? tenant.customDomainVerifiedAt.toISOString()
              : null,
          }}
        />
      </Panel>

      <Panel title="Plan">
        {isPlanKey(tenant.plan) ? (
          <PlanChange
            tenantId={tenant.id}
            currentPlan={tenant.plan as PlanKey}
            centreCount={tenant.centres.length}
          />
        ) : (
          <p className="text-sm text-rose-400">Unknown plan: {tenant.plan}</p>
        )}
      </Panel>

      <Panel title="Features">
        {isPlanKey(tenant.plan) ? (
          <FeatureMatrix
            tenantId={tenant.id}
            allowOverrides={planAllowsOverrides(tenant.plan as PlanKey)}
            initial={featureRows(tenant.features, tenant.plan as PlanKey)}
          />
        ) : null}
      </Panel>

      <Panel title="Decommission tenant">
        <OffboardPanel
          tenantId={tenant.id}
          tenantName={tenant.name}
          canManage={ownerCan(ownerSession!.role, "tenant.change_status")}
          initial={{
            status: tenant.status,
            scheduledAt: tenant.offboardingScheduledAt ? tenant.offboardingScheduledAt.toISOString() : null,
            notes: tenant.offboardingNotes,
          }}
        />
      </Panel>
    </div>
  );
}

function featureRows(
  rows: { featureKey: string; enabled: boolean }[],
  plan: PlanKey,
): { key: FeatureKey; enabled: boolean }[] {
  // Synthesise a row for any feature key that doesn't yet have an OrgFeature
  // entry (e.g. a feature added after this tenant onboarded). Default for
  // missing rows = whatever the plan says.
  const planSet = new Set<FeatureKey>(PLAN_REGISTRY[plan].features);
  const map = new Map(rows.map((r) => [r.featureKey, r.enabled]));
  return FEATURE_KEYS.map((k) => ({
    key: k,
    enabled: map.has(k) ? !!map.get(k) : planSet.has(k),
  }));
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}
