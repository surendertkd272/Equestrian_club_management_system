// Catalog data that's identical across every club (skill tree, scoring rubrics,
// default fee plans). Called both by the seed script and the POST /api/centres
// route so a freshly-created club is usable immediately — manager just needs to
// add staff/batches/horses/meds via the existing admin pages.

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import fs from "node:fs";
import path from "node:path";

// Canonical Equiwings rubric for Levels 1–4 — single source of truth that
// drives BOTH the exam scoring (ScoringTemplate) AND the rider progress
// tracking (ProgressLevel + Skill). Each item in a rubric category becomes
// a trackable skill at that level; sub-items are flattened with a "Parent —
// Subitem" name so the progress UI can list them flat.
//
// Shared with prisma/seed.ts.
type RubricItem = {
  name: string;
  max_score?: number | null;
  subitems?: RubricItem[];
};
type RubricCategory = { name: string; items: RubricItem[] };
type CanonRubric = {
  code?: string;
  levelName: string;
  subtitle?: string;
  passThreshold: number;
  totalMax?: number;
  categories: RubricCategory[];
  meta?: unknown;
};
const EQUIWINGS_RUBRICS: Record<string, CanonRubric> = (() => {
  try {
    const p = path.join(process.cwd(), "prisma", "equiwings-level-rubrics.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
})();

// Flatten a category's items into (categoryName, displayName) pairs that
// become Skill rows. Sub-items become "Parent — Child" composite names so
// the flat skill list stays scannable. Parent rows that have only subitems
// (max_score: null) are dropped — only leaf items are trackable.
function flattenSkills(categories: RubricCategory[]): { discipline: string; name: string }[] {
  const out: { discipline: string; name: string }[] = [];
  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.subitems && item.subitems.length > 0) {
        for (const sub of item.subitems) {
          out.push({ discipline: cat.name, name: `${item.name} — ${sub.name}` });
        }
      } else {
        out.push({ discipline: cat.name, name: item.name });
      }
    }
  }
  return out;
}


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
  // Default fee plans — one per canonical level. Amounts are starter
  // values; centre managers tune them via /catalog → Fee Plans.
  const FEE_PLAN_DEFAULTS: Record<string, { monthly: number; registration: number }> = {
    "Level 1": { monthly: 8000, registration: 3000 },
    "Level 2": { monthly: 10000, registration: 3000 },
    "Level 3": { monthly: 12000, registration: 3000 },
    "Level 4": { monthly: 14000, registration: 3000 },
  };
  for (const [levelName, amounts] of Object.entries(FEE_PLAN_DEFAULTS)) {
    await prisma.feePlan.upsert({
      where: { centreId_levelName: { centreId, levelName } },
      create: { centreId, levelName, monthlyAmount: amounts.monthly, registrationAmount: amounts.registration },
      update: {},
    });
  }

  // Progress levels + Skill catalog — derived from the canonical rubric file.
  // Each rubric category becomes the Skill.discipline value; every leaf rubric
  // item becomes a Skill row. Sub-items get flattened with "Parent — Child"
  // composite names so the progress list stays flat and scannable.
  const levelKeys = ["1", "2", "3", "4"] as const;
  for (let i = 0; i < levelKeys.length; i++) {
    const key = levelKeys[i]!;
    const rubric = EQUIWINGS_RUBRICS[key];
    if (!rubric) continue; // canonical file missing — skip rather than seed garbage
    const level = await prisma.progressLevel.upsert({
      where: { centreId_name: { centreId, name: rubric.levelName } },
      create: { centreId, name: rubric.levelName, order: i + 1 },
      update: { order: i + 1 },
    });
    const skills = flattenSkills(rubric.categories);
    for (const s of skills) {
      const existing = await prisma.skill.findFirst({
        where: { levelId: level.id, discipline: s.discipline, name: s.name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.skill.create({ data: { levelId: level.id, discipline: s.discipline, name: s.name } });
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
      // jsonb column — pass the array directly (post-migration in 81f142a).
      // EQUIWINGS_RUBRICS types its categories as unknown[]; cast to the
      // InputJsonValue Prisma expects without losing the runtime shape.
      categoriesJson: r.categories as Prisma.InputJsonValue,
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
