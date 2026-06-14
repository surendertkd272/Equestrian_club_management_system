// Seeds the "Daily Horse Riding Coach Checklist" (the EQUIWINGS paper form) as a
// general-scope ChecklistTemplate for EVERY centre in the Equiwings org only —
// other tenants build their own. Idempotent: an existing template of the same
// name (and its submissions) is deleted first, then recreated, so re-running
// always lands the current item set.
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

// 34 particulars, verbatim from the EQUIWINGS form. orderIndex = the form's S.No.
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
  { label: "Any other issue requiring management attention", section: S_OTHER },
];

type Db = Pick<PrismaClient, "organisation" | "centre" | "checklistTemplate" | "checklistSubmission">;

// Idempotently (re)seed the coach checklist for every centre in the Equiwings
// org. Returns a per-centre summary. Touches NO other org.
export async function seedEquiwingsCoachChecklist(
  db: Db,
  log: (msg: string) => void = console.log,
): Promise<{ org: string; centres: number; created: number }> {
  const org = await db.organisation.findFirst({ where: { slug: ORG_SLUG }, select: { id: true, name: true } });
  if (!org) throw new Error(`Org with slug '${ORG_SLUG}' not found — nothing to seed.`);

  const centres = await db.centre.findMany({ where: { orgId: org.id }, select: { id: true, name: true } });
  if (centres.length === 0) {
    log(`Org '${org.name}' has no centres. Nothing to do.`);
    return { org: org.name, centres: 0, created: 0 };
  }
  log(`Seeding "${TEMPLATE_NAME}" (${COACH_CHECKLIST_ITEMS.length} items) for ${centres.length} centre(s) in "${org.name}"…\n`);

  let created = 0;
  for (const c of centres) {
    // Idempotent: drop any existing same-named template for this centre first.
    const existing = await db.checklistTemplate.findMany({
      where: { centreId: c.id, name: TEMPLATE_NAME },
      select: { id: true },
    });
    if (existing.length > 0) {
      const ids = existing.map((t) => t.id);
      // Submissions don't cascade from the template — delete them first
      // (their items cascade), then the template (its items cascade).
      const subs = await db.checklistSubmission.deleteMany({ where: { templateId: { in: ids } } });
      await db.checklistTemplate.deleteMany({ where: { id: { in: ids } } });
      log(`  ${c.name}: removed ${existing.length} existing template(s) + ${subs.count} submission(s).`);
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
  log("\nDone.");
  return { org: org.name, centres: centres.length, created };
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
