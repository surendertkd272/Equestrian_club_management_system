// Seeds the "Daily Horse Riding Coach Checklist" (the EQUIWINGS paper form) as
// THE general-scope ChecklistTemplate for EVERY centre in the Equiwings org
// only — other tenants build their own. A centre can have just one general
// template (unique on centreId+scope), so the coach checklist *is* the general
// daily checklist: any existing general template (and its submissions) is
// deleted first, then the coach checklist is created in its place. Idempotent —
// re-running always lands the current item set. The per_horse template is left
// untouched.
//
//   DATABASE_URL=… npx tsx scripts/seed-equiwings-coach-checklist.ts
//
// Targets the org by slug 'equiwings'. The CLI runner uses a raw PrismaClient
// (no RLS GUCs), so it runs permissively even against the app_rls pooler
// connection. The core is exported as a pure function for the test harness.

import { PrismaClient } from "@prisma/client";

export const ORG_SLUG = "equiwings";
export const TEMPLATE_NAME = "Daily Horse Riding Coach Checklist";

const S_HORSES = "1 · Horses & Stable Management";
const S_RIDER = "2 · Rider Safety & Incidents";
const S_OTHER = "3 · Other Observations";

// The EQUIWINGS form's particulars, verbatim. orderIndex = position below.
// (The "Club video shared on WhatsApp" flag from the form is the last-but-one
// item; "any other issue" stays the catch-all last row.)
export const COACH_CHECKLIST_ITEMS: { label: string; section: string }[] = [
  { label: "All horses are fit and healthy", section: S_HORSES },
  { label: "All horses massage done", section: S_HORSES },
  { label: "All horses hooves cleaned", section: S_HORSES },
  { label: "All horses sand bath done", section: S_HORSES },
  { label: "All horses ears cleaned", section: S_HORSES },
  { label: "All horses eyes cleaned", section: S_HORSES },
  { label: "All horse stables have Pink Salt Bricks", section: S_HORSES },
  { label: "All horses' fodder and water troughs cleaned", section: S_HORSES },
  { label: "All horses have clean drinking water", section: S_HORSES },
  { label: "Feeding schedule followed", section: S_HORSES },
  { label: "All horses exercised today", section: S_HORSES },
  { label: "All stables cleaned", section: S_HORSES },
  { label: "All stables have rubber mats in good condition", section: S_HORSES },
  { label: "All stable fans working properly", section: S_HORSES },
  { label: "All stable lights working properly", section: S_HORSES },
  { label: "Water coolers / mist fans working", section: S_HORSES },
  { label: "All bits cleaned and disinfected", section: S_HORSES },
  { label: "All saddles cleaned", section: S_HORSES },
  { label: "All bridles cleaned", section: S_HORSES },
  { label: "All saddle pads dried and stored properly", section: S_HORSES },
  { label: "All tack kept properly in tack room", section: S_HORSES },
  { label: "All hooves and horseshoes intact", section: S_HORSES },
  { label: "Any horse injury reported (note horse name in remarks)", section: S_HORSES },
  { label: "Any horse showing signs of lameness (note horse name in remarks)", section: S_HORSES },
  { label: "Manure disposal completed", section: S_HORSES },
  { label: "All coaches in proper uniform", section: S_HORSES },
  { label: "All grooms in proper uniform", section: S_HORSES },
  { label: "Riding arena safe for horses", section: S_HORSES },
  { label: "Riding arena safe for riders", section: S_HORSES },
  { label: "Emergency medicine stock available", section: S_HORSES },
  { label: "Any rider fall occurred today (note rider name in remarks)", section: S_RIDER },
  { label: "Any serious injury reported (note details in remarks)", section: S_RIDER },
  { label: "All riders in proper riding uniform and safety gear", section: S_RIDER },
  { label: "Club video shared on WhatsApp today", section: S_OTHER },
  { label: "Any other issue requiring management attention", section: S_OTHER },
];

type Db = Pick<PrismaClient, "organisation" | "centre" | "checklistTemplate" | "checklistSubmission">;

// Idempotently (re)seed the coach checklist for every centre in the Equiwings
// org. Returns a per-centre summary. Touches NO other org.
// Canonical signature of an item set (label/section/orderIndex), order-stable.
function itemsSignature(items: { label: string; section: string | null; orderIndex: number }[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((i) => [i.orderIndex, i.label, i.section ?? null]),
  );
}
const DESIRED_SIG = itemsSignature(
  COACH_CHECKLIST_ITEMS.map((it, i) => ({ label: it.label, section: it.section, orderIndex: i + 1 })),
);

export async function seedEquiwingsCoachChecklist(
  db: Db,
  log: (msg: string) => void = console.log,
): Promise<{ org: string; centres: number; created: number; skipped: number }> {
  const org = await db.organisation.findFirst({ where: { slug: ORG_SLUG }, select: { id: true, name: true } });
  if (!org) throw new Error(`Org with slug '${ORG_SLUG}' not found — nothing to seed.`);

  const centres = await db.centre.findMany({ where: { orgId: org.id }, select: { id: true, name: true } });
  if (centres.length === 0) {
    log(`Org '${org.name}' has no centres. Nothing to do.`);
    return { org: org.name, centres: 0, created: 0, skipped: 0 };
  }
  log(`Seeding "${TEMPLATE_NAME}" (${COACH_CHECKLIST_ITEMS.length} items) for ${centres.length} centre(s) in "${org.name}"…\n`);

  let created = 0;
  let skipped = 0;
  for (const c of centres) {
    // A centre may hold only one general template (unique centreId+scope).
    const existing = await db.checklistTemplate.findFirst({
      where: { centreId: c.id, scope: "general" },
      select: {
        id: true,
        name: true,
        items: { select: { label: true, section: true, orderIndex: true } },
      },
    });

    // Non-destructive: if the general template is already this checklist with an
    // identical item set, leave it (and its submissions + manager sign-offs)
    // alone. A re-run only rewrites when something actually changed.
    if (existing && existing.name === TEMPLATE_NAME && itemsSignature(existing.items) === DESIRED_SIG) {
      skipped += 1;
      log(`  ${c.name}: already up to date — left intact (${existing.items.length} items, submissions preserved).`);
      continue;
    }

    if (existing) {
      // Replace whatever general template it has — by scope, not by name — so
      // the coach checklist becomes THE general daily checklist. Submissions
      // don't cascade from the template, so delete them first (their items
      // cascade), then the template (its items cascade).
      const subs = await db.checklistSubmission.deleteMany({ where: { templateId: existing.id } });
      await db.checklistTemplate.delete({ where: { id: existing.id } });
      log(`  ${c.name}: replaced general template "${existing.name}" (+${subs.count} submission(s) removed).`);
    }

    await db.checklistTemplate.create({
      data: {
        centreId: c.id,
        scope: "general",
        name: TEMPLATE_NAME,
        active: true,
        items: {
          create: COACH_CHECKLIST_ITEMS.map((it, i) => ({
            label: it.label,
            section: it.section,
            orderIndex: i + 1,
            active: true,
          })),
        },
      },
    });
    created += 1;
    log(`  ${c.name}: created with ${COACH_CHECKLIST_ITEMS.length} items.`);
  }
  log(`\nDone. created=${created}, skipped=${skipped}.`);
  return { org: org.name, centres: centres.length, created, skipped };
}

// CLI runner — only when invoked directly (not when imported by the test
// harness). Uses a fresh raw PrismaClient so RLS stays permissive in prod.
if (process.argv[1]?.includes("seed-equiwings-coach-checklist")) {
  const prisma = new PrismaClient();
  seedEquiwingsCoachChecklist(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
