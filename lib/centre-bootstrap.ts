// Catalog data that's identical across every club (skill tree, scoring rubrics,
// default fee plans). Called both by the seed script and the POST /api/centres
// route so a freshly-created club is usable immediately — manager just needs to
// add staff/batches/horses/meds via the existing admin pages.

import { prisma } from "./prisma";
import fs from "node:fs";
import path from "node:path";

// Canonical Equiwings rubric for general Levels 1–4 — single source of truth,
// shared with prisma/seed.ts. Each club's ScoringTemplate rows are seeded from
// THIS so the scorer (which reads ScoringTemplate) matches ExamLevel.defaultRubricJson.
type CanonRubric = { levelName: string; passThreshold: number; categories: unknown[] };
const EQUIWINGS_RUBRICS: Record<string, CanonRubric> = (() => {
  try {
    const p = path.join(process.cwd(), "prisma", "equiwings-level-rubrics.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
})();

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

  // Scoring templates — all 4 canonical Equiwings levels, seeded from
  // equiwings-level-rubrics.json (the same file ExamLevel.defaultRubricJson
  // uses). `update` is populated so re-running the bootstrap REPAIRS any club
  // seeded with the old generic 2-level rubric (self-healing backfill).
  for (const levelKey of ["1", "2", "3", "4"] as const) {
    const r = EQUIWINGS_RUBRICS[levelKey];
    if (!r) continue; // canonical file missing — skip rather than seed garbage
    const data = {
      levelName: r.levelName,
      passThreshold: r.passThreshold,
      categoriesJson: JSON.stringify(r.categories),
    };
    await prisma.scoringTemplate.upsert({
      where: { centreId_levelKey: { centreId, levelKey } },
      create: { centreId, levelKey, ...data },
      update: data,
    });
  }

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
