// Catalog data that's identical across every club (skill tree, scoring rubrics,
// default fee plans). Called both by the seed script and the POST /api/centres
// route so a freshly-created club is usable immediately — manager just needs to
// add staff/batches/horses/meds via the existing admin pages.

import { prisma } from "./prisma";

const SKILL_TREE: Record<string, Record<string, string[]>> = {
  normal: {
    Beginner: ["Mount & dismount", "Halt", "Walk on a circle", "Posting trot (straight)", "Aids for forward/halt"],
    Intermediate: ["Sitting trot (5 strides)", "Two-point at trot", "Walk-trot-walk transitions", "Canter on correct lead"],
    Advanced: ["Counter canter", "Half-halt", "Working canter on 20m circle", "Riding without stirrups"],
  },
  dressage: {
    Beginner: ["20m circle at walk", "Halt at X", "Straightness on long side"],
    Intermediate: ["20m circle at trot", "Free walk on long rein", "Leg yield at walk"],
    Advanced: ["Shoulder-in at trot", "Simple change", "Medium trot"],
  },
  jumping: {
    Beginner: ["Walk over poles", "Trot over single pole"],
    Intermediate: ["Cross-rail single", "3 trot poles + cross-rail", "Two-point over jump"],
    Advanced: ["60cm vertical course", "Related distance 5 strides", "Bending line"],
  },
  gymkhana: {
    Beginner: ["Lead-line walk obstacle"],
    Intermediate: ["Pole bending (walk)", "Barrel turn at trot"],
    Advanced: ["Pole bending (canter)", "Flag race at canter"],
  },
  tent_pegging: {
    Intermediate: ["Walk approach + lance carry"],
    Advanced: ["Trot tent peg pickup", "Canter tent peg pickup"],
  },
  endurance: {
    Intermediate: ["20-min trot circuit"],
    Advanced: ["60-min endurance ride with vet check"],
  },
};

const LEVEL_1_RUBRIC = [
  {
    name: "Dress & Equipment",
    items: [
      { name: "Helmet (ASTM/ISI certified)", max_score: 5 },
      { name: "Boots / jodhpurs", max_score: 5 },
      { name: "Gloves", max_score: 2 },
    ],
  },
  {
    name: "Stable Management",
    items: [
      { name: "Approach & handling", max_score: 5 },
      { name: "Grooming basics", max_score: 5 },
      { name: "Tacking up assistance", max_score: 5 },
    ],
  },
  {
    name: "Riding Position",
    items: [
      { name: "Seat", max_score: 10 },
      { name: "Hands & contact", max_score: 10 },
      { name: "Heels down / leg position", max_score: 5 },
    ],
  },
  {
    name: "Basic Paces",
    items: [
      { name: "Halt / mount / dismount", max_score: 5 },
      { name: "Walk on a circle", max_score: 10 },
      { name: "Rising trot (straight line)", max_score: 10 },
    ],
  },
  { name: "Remarks by Jury", type: "text" as const, items: [{ name: "Overall observations", max_score: 0 }] },
];

const LEVEL_2_RUBRIC = [
  {
    name: "Dress & Equipment",
    items: [
      { name: "Helmet", max_score: 5 },
      { name: "Boots / jodhpurs", max_score: 5 },
    ],
  },
  {
    name: "Stable Management",
    items: [
      { name: "Independent tacking up", max_score: 8 },
      { name: "Feeding & watering knowledge", max_score: 6 },
      { name: "Identifying basic ailments", max_score: 6 },
    ],
  },
  {
    name: "Riding Position",
    items: [
      { name: "Seat", max_score: 10 },
      { name: "Hands & contact", max_score: 10 },
      { name: "Two-point at trot", max_score: 8 },
    ],
  },
  {
    name: "Paces & Transitions",
    items: [
      { name: "Sitting trot (5 strides)", max_score: 8 },
      { name: "Canter on correct lead", max_score: 12 },
      { name: "Transitions walk-trot-walk", max_score: 8 },
      { name: "Pole work (3 trot poles)", max_score: 8 },
    ],
  },
  {
    name: "Theory Questions",
    type: "select" as const,
    options: ["Correct", "Partial", "Incorrect"],
    items: [
      { name: "Parts of a saddle", max_score: 0 },
      { name: "Three points of a horse's hoof", max_score: 0 },
    ],
  },
  { name: "Remarks by Jury", type: "text" as const, items: [{ name: "Overall observations", max_score: 0 }] },
];

// PDF §2 wound & bandaging consumables. Seeded on centre creation so new
// tenants don't stare at empty cabinets. Quantities are typical for a
// small-to-medium club; clubs adjust via the inventory UI.
// (Note: the former STANDARD_EQUIPMENT list was dropped along with the
// per-item Asset model — bulk equipment seeding now happens via the
// EquipmentCatalog the HQ team curates.)

const STANDARD_CONSUMABLES: Array<{
  name: string;
  category: string;
  unit: string;
  qty: number;
  reorderThreshold: number;
}> = [
  // Bandaging (PDF §2)
  { name: "Sterile Gauze Pad — 10×10 cm", category: "bandage", unit: "pad", qty: 50, reorderThreshold: 20 },
  { name: "Cotton Roll / Gamgee", category: "bandage", unit: "roll", qty: 10, reorderThreshold: 4 },
  { name: "Vet Wrap (self-adhesive bandage)", category: "bandage", unit: "roll", qty: 12, reorderThreshold: 5 },
  { name: "Elastikon Support Tape", category: "bandage", unit: "roll", qty: 6, reorderThreshold: 3 },
  { name: "Non-stick Wound Pad", category: "dressing", unit: "pad", qty: 30, reorderThreshold: 10 },
  // Cleaning / antiseptic
  { name: "Sterile Saline (0.9%) ampoule", category: "dressing", unit: "ml", qty: 1000, reorderThreshold: 250 },
  // Hygiene
  { name: "Disposable Nitrile Gloves (M)", category: "hygiene", unit: "pair", qty: 100, reorderThreshold: 30 },
  // Tools
  { name: "Bandage Scissors", category: "tool", unit: "each", qty: 2, reorderThreshold: 1 },
];

// PDF §4 "Vaccination Records & Schedules" — the schedule template a vet
// follows for every horse. Created per centre as templates; vets clone them
// onto individual horses via /vaccinations.
// (Not seeded onto every horse automatically — we don't presume which horses
// already had their tetanus shot. The vet decides.)

// Bootstrap the catalog data for a freshly-created centre. Idempotent — every
// piece uses upsert / skip-if-exists so it's safe to call against a centre
// that's already partially set up.
export async function bootstrapCentreCatalog(centreId: string): Promise<void> {
  // Fee plans
  await prisma.feePlan.upsert({
    where: { centreId_levelName: { centreId, levelName: "Beginner" } },
    create: { centreId, levelName: "Beginner", monthlyAmount: 8000, registrationAmount: 3000 },
    update: {},
  });
  await prisma.feePlan.upsert({
    where: { centreId_levelName: { centreId, levelName: "Intermediate" } },
    create: { centreId, levelName: "Intermediate", monthlyAmount: 10000, registrationAmount: 3000 },
    update: {},
  });

  // Progress levels
  const beginnerLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId, name: "Beginner" } },
    create: { centreId, name: "Beginner", order: 1 },
    update: {},
  });
  const intermediateLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId, name: "Intermediate" } },
    create: { centreId, name: "Intermediate", order: 2 },
    update: {},
  });
  const advancedLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId, name: "Advanced" } },
    create: { centreId, name: "Advanced", order: 3 },
    update: {},
  });
  const levelByName: Record<string, { id: string }> = {
    Beginner: beginnerLevel,
    Intermediate: intermediateLevel,
    Advanced: advancedLevel,
  };

  // Skill catalog
  for (const [discipline, byLevel] of Object.entries(SKILL_TREE)) {
    for (const [levelName, names] of Object.entries(byLevel)) {
      const level = levelByName[levelName];
      if (!level) continue;
      const existing = await prisma.skill.findFirst({ where: { levelId: level.id, discipline }, select: { id: true } });
      if (existing) continue;
      for (const name of names) {
        await prisma.skill.create({ data: { levelId: level.id, discipline, name } });
      }
    }
  }

  // Scoring templates
  await prisma.scoringTemplate.upsert({
    where: { centreId_levelKey: { centreId, levelKey: "1" } },
    create: {
      centreId,
      levelKey: "1",
      levelName: "Level 1 — Beginner",
      passThreshold: 60,
      categoriesJson: JSON.stringify(LEVEL_1_RUBRIC),
    },
    update: {},
  });
  await prisma.scoringTemplate.upsert({
    where: { centreId_levelKey: { centreId, levelKey: "2" } },
    create: {
      centreId,
      levelKey: "2",
      levelName: "Level 2 — Intermediate",
      passThreshold: 65,
      categoriesJson: JSON.stringify(LEVEL_2_RUBRIC),
    },
    update: {},
  });

  // Individual-Asset seeding removed — the Asset model was dropped when the
  // /tack route was consolidated into /equipment (bulk-stock-only). Starter
  // equipment now lives in the per-centre EquipmentStock that the inventory
  // manager populates from the catalog.

  // PDF §2 — Wound & Bandaging consumables. One starter set per centre so
  // the first-aid kit is never literally empty.
  const existingConsumables = await prisma.consumable.count({ where: { centreId } });
  if (existingConsumables === 0) {
    await prisma.consumable.createMany({
      data: STANDARD_CONSUMABLES.map((c) => ({ centreId, ...c })),
    });
  }
}
