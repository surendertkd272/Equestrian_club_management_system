// One-off migration to swap the seeded equipment catalog with the new
// Indian-equestrian / polo / tent-pegging list provided by the Equiwings
// inventory team via WhatsApp (17-Oct-2025).
//
// Why not just re-run the seed? prisma.equipmentCatalog.upsert is
// idempotent on the new rows but it doesn't delete the old ones — so the
// generic UK/Western items (snaffle bridle, dressage saddle, etc) would
// still appear in pickers. We can't hard-delete the old rows either:
// EquipmentStock has a foreign-key to EquipmentCatalog.code. Soft-deactivate
// (`active=false`) preserves history while hiding them from new pickers,
// which is what we want.
//
// Run with: npx tsx scripts/replace-equipment-catalog.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NEW_CATALOG: { category: string; code: string; name: string; unit: string; defaultThreshold: number }[] = [
  // Saddlery
  { category: "saddlery", code: "saddle_indian_trooper", name: "Indian trooper saddle", unit: "piece", defaultThreshold: 4 },
  { category: "saddlery", code: "saddle_polo", name: "Polo saddle", unit: "piece", defaultThreshold: 4 },
  { category: "saddlery", code: "saddle_leather", name: "Leather saddle", unit: "piece", defaultThreshold: 4 },
  { category: "saddlery", code: "pad_foam", name: "Foam saddle pad", unit: "piece", defaultThreshold: 8 },
  { category: "saddlery", code: "pad_gel", name: "Gel saddle pad", unit: "piece", defaultThreshold: 6 },
  { category: "saddlery", code: "pad_fur", name: "Fur saddle pad", unit: "piece", defaultThreshold: 6 },
  { category: "saddlery", code: "pad_indian", name: "Indian saddle pad", unit: "piece", defaultThreshold: 8 },
  { category: "saddlery", code: "pad_black", name: "Black saddle pad", unit: "piece", defaultThreshold: 6 },
  { category: "saddlery", code: "girth_belt", name: "Girth belt", unit: "piece", defaultThreshold: 8 },
  { category: "saddlery", code: "girth_long", name: "Long girth", unit: "piece", defaultThreshold: 6 },
  { category: "saddlery", code: "chest_belt", name: "Chest belt", unit: "piece", defaultThreshold: 4 },
  { category: "saddlery", code: "stirrup_iron", name: "Iron stirrup", unit: "pair", defaultThreshold: 8 },
  { category: "saddlery", code: "stirrup_belt", name: "Stirrup belt", unit: "pair", defaultThreshold: 8 },
  { category: "saddlery", code: "pisova", name: "Pisova", unit: "piece", defaultThreshold: 4 },

  // Bridlery
  { category: "bridlery", code: "bridle_set", name: "Bridle set", unit: "set", defaultThreshold: 6 },
  { category: "bridlery", code: "bit_d", name: "D bit", unit: "piece", defaultThreshold: 4 },
  { category: "bridlery", code: "bit_ring", name: "Ring bit", unit: "piece", defaultThreshold: 4 },
  { category: "bridlery", code: "bit_pelham", name: "Pelham bit", unit: "piece", defaultThreshold: 3 },
  { category: "bridlery", code: "head_collar", name: "Head collar", unit: "piece", defaultThreshold: 10 },
  { category: "bridlery", code: "rein", name: "Rein", unit: "pair", defaultThreshold: 6 },
  { category: "bridlery", code: "martingale", name: "Martingale", unit: "piece", defaultThreshold: 4 },
  { category: "bridlery", code: "reins_side", name: "Side reins", unit: "pair", defaultThreshold: 3 },

  // Protection (boots + bandages)
  { category: "protection", code: "bandage_polo", name: "Polo bandage", unit: "set", defaultThreshold: 8 },
  { category: "protection", code: "boot_tendon", name: "Tendon boot", unit: "pair", defaultThreshold: 6 },
  { category: "protection", code: "boot_hand", name: "Hand boot", unit: "pair", defaultThreshold: 6 },
  { category: "protection", code: "boot_corner", name: "Corner boot", unit: "pair", defaultThreshold: 4 },

  // Grooming
  { category: "grooming", code: "hoof_picker", name: "Hoof picker", unit: "piece", defaultThreshold: 8 },
  { category: "grooming", code: "brush", name: "Brush", unit: "piece", defaultThreshold: 8 },
  { category: "grooming", code: "comb_rubber", name: "Rubber comb", unit: "piece", defaultThreshold: 6 },
  { category: "grooming", code: "comb_metal", name: "Metal comb", unit: "piece", defaultThreshold: 6 },
  { category: "grooming", code: "glove_rubber", name: "Rubber glove (grooming)", unit: "pair", defaultThreshold: 6 },
  { category: "grooming", code: "kharara_metal", name: "Metal kharara", unit: "piece", defaultThreshold: 6 },

  // Arena & jumping
  { category: "arena", code: "jump_wing", name: "Jumping wing", unit: "pair", defaultThreshold: 6 },
  { category: "arena", code: "pole_hook", name: "Pole hook", unit: "piece", defaultThreshold: 24 },
  { category: "arena", code: "jump_pole_balli", name: "Balli / jumping pole", unit: "piece", defaultThreshold: 20 },
  { category: "arena", code: "lunge_rope", name: "Lunging rope", unit: "piece", defaultThreshold: 4 },
  { category: "arena", code: "fence_number", name: "Fence number", unit: "piece", defaultThreshold: 30 },
  { category: "arena", code: "flag_red", name: "Red flag", unit: "piece", defaultThreshold: 6 },
  { category: "arena", code: "flag_white", name: "White flag", unit: "piece", defaultThreshold: 6 },

  // Tent pegging
  { category: "tent_pegging", code: "lance", name: "Lance", unit: "piece", defaultThreshold: 4 },
  { category: "tent_pegging", code: "peg", name: "Peg", unit: "piece", defaultThreshold: 20 },
  { category: "tent_pegging", code: "ring", name: "Ring", unit: "piece", defaultThreshold: 12 },
  { category: "tent_pegging", code: "ring_stand", name: "Ring stand", unit: "piece", defaultThreshold: 6 },
  { category: "tent_pegging", code: "punji", name: "Punji", unit: "piece", defaultThreshold: 8 },
  { category: "tent_pegging", code: "punji_grass", name: "Grass punji", unit: "piece", defaultThreshold: 8 },
  { category: "tent_pegging", code: "hole_punch", name: "Hole maker / hole punch", unit: "piece", defaultThreshold: 2 },

  // Polo
  { category: "polo", code: "polo_mallet_big", name: "Polo mallet (big)", unit: "piece", defaultThreshold: 6 },
  { category: "polo", code: "polo_mallet_small", name: "Polo mallet (small)", unit: "piece", defaultThreshold: 6 },

  // Facility
  { category: "facility", code: "fridge", name: "Fridge", unit: "piece", defaultThreshold: 1 },
];

async function main() {
  console.log("Replacing equipment catalog…");

  const newCodes = new Set(NEW_CATALOG.map((i) => i.code));

  // 1. Deactivate every old row that isn't in the new list. The new list
  // itself will be re-activated by the upsert below, so we don't need to
  // exclude it from the deactivate step.
  const before = await prisma.equipmentCatalog.count({ where: { active: true } });
  const deactivated = await prisma.equipmentCatalog.updateMany({
    where: { code: { notIn: [...newCodes] }, active: true },
    data: { active: false },
  });
  console.log(`Deactivated ${deactivated.count} old items (kept as soft-deleted history).`);

  // 2. Upsert the new list — creates fresh rows, re-activates any code
  // that already existed (e.g. bit_pelham was in both lists).
  let created = 0;
  let updated = 0;
  for (const item of NEW_CATALOG) {
    const existing = await prisma.equipmentCatalog.findUnique({ where: { code: item.code } });
    await prisma.equipmentCatalog.upsert({
      where: { code: item.code },
      create: { ...item, active: true },
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        defaultThreshold: item.defaultThreshold,
        active: true,
      },
    });
    if (existing) updated++;
    else created++;
  }

  const after = await prisma.equipmentCatalog.count({ where: { active: true } });
  console.log(`Inserted ${created} new items, updated ${updated} existing.`);
  console.log(`Active catalog: ${before} → ${after} rows.`);

  // 3. List what's now active, grouped by category — quick visual sanity check.
  const live = await prisma.equipmentCatalog.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const byCat = new Map<string, string[]>();
  for (const item of live) {
    if (!byCat.has(item.category)) byCat.set(item.category, []);
    byCat.get(item.category)!.push(item.name);
  }
  console.log("");
  console.log("Active catalog after migration:");
  for (const [cat, items] of byCat) {
    console.log(`  ${cat} (${items.length})`);
    for (const name of items) console.log(`    · ${name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
