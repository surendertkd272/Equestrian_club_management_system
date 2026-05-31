// Toggle the fee-collection master switch for a tenant org.
//
// Usage:
//   npx tsx scripts/toggle-fee-collection.ts list
//   npx tsx scripts/toggle-fee-collection.ts <orgId|slug> on
//   npx tsx scripts/toggle-fee-collection.ts <orgId|slug> off
//
// 'list' prints every org with its current fee-collection state — handy
// for finding the orgId you want before flipping. The on/off commands
// upsert the OrgFeature row, so a tenant with no explicit row yet gets
// one created at the requested state.
//
// Safe to run against prod DBs — the action itself is reversible. No
// SQLite guard like the backfill scripts because that's exactly the
// place this matters most.
//
// Owner-portal users: the same toggle is available from the org's
// feature matrix. This script exists for headless / scripted flips
// (e.g. enabling on a fresh tenant during onboarding automation).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FEATURE_KEY = "fee-collection";

async function list() {
  const orgs = await prisma.organisation.findMany({
    select: { id: true, slug: true, name: true, status: true, plan: true },
    orderBy: { name: "asc" },
  });
  if (orgs.length === 0) {
    console.log("(no orgs)");
    return;
  }

  // One query for all the fee-collection rows; map by orgId.
  const rows = await prisma.orgFeature.findMany({
    where: { featureKey: FEATURE_KEY },
    select: { orgId: true, enabled: true, enabledAt: true },
  });
  const byOrg = new Map(rows.map((r) => [r.orgId, r]));

  const pad = (s: string, n: number) => s.length >= n ? s : s + " ".repeat(n - s.length);

  console.log(
    pad("Org slug", 22) +
    pad("Name", 28) +
    pad("Plan", 12) +
    pad("Status", 12) +
    pad("Fees", 6) +
    "OrgId",
  );
  console.log("-".repeat(110));
  for (const o of orgs) {
    const row = byOrg.get(o.id);
    const state = row ? (row.enabled ? "ON" : "OFF") : "—";
    console.log(
      pad(o.slug, 22) +
      pad(o.name.slice(0, 27), 28) +
      pad(o.plan, 12) +
      pad(o.status, 12) +
      pad(state, 6) +
      o.id,
    );
  }
  console.log("");
  console.log("Legend: '—' = no explicit OrgFeature row (resolves to OFF since the lookup is positive).");
}

async function setFlag(orgIdOrSlug: string, enabled: boolean) {
  // Accept either the cuid or the slug — slug is friendlier on a CLI.
  const org = await prisma.organisation.findFirst({
    where: { OR: [{ id: orgIdOrSlug }, { slug: orgIdOrSlug }] },
    select: { id: true, slug: true, name: true },
  });
  if (!org) {
    console.error(`Org not found: ${orgIdOrSlug}`);
    process.exit(1);
  }

  const prior = await prisma.orgFeature.findUnique({
    where: { orgId_featureKey: { orgId: org.id, featureKey: FEATURE_KEY } },
    select: { enabled: true },
  });
  const priorState = prior ? (prior.enabled ? "ON" : "OFF") : "—";

  await prisma.orgFeature.upsert({
    where: { orgId_featureKey: { orgId: org.id, featureKey: FEATURE_KEY } },
    create: {
      orgId: org.id,
      featureKey: FEATURE_KEY,
      enabled,
    },
    update: {
      enabled,
      enabledAt: new Date(),
    },
  });

  console.log(
    `${org.name} (${org.slug}): fee-collection ${priorState} → ${enabled ? "ON" : "OFF"}`,
  );
  if (!enabled) {
    console.log(
      "  → New enrolments auto-activate (no invoice). " +
      "Existing invoices preserved but hidden from parent + admin surfaces. " +
      "Razorpay endpoints return 503; webhook no-ops with audit.",
    );
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === "list" || cmd === "ls") {
    await list();
    return;
  }
  if (arg !== "on" && arg !== "off") {
    console.error("Usage: toggle-fee-collection.ts list | <orgId|slug> on|off");
    process.exit(2);
  }
  await setFlag(cmd, arg === "on");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
