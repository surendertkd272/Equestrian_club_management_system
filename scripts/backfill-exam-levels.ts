// Repair existing clubs' exam levels. The patched bootstrapCentreCatalog is
// self-healing (ScoringTemplate upsert now has a populated `update`), so we
// just re-run it for every centre. Idempotent; no rider data touched.
//
// Run: npx tsx scripts/backfill-exam-levels.ts
import { prisma } from "../lib/prisma";
import { bootstrapCentreCatalog } from "../lib/centre-bootstrap";

async function main() {
  const centres = await prisma.centre.findMany({ select: { id: true, name: true } });
  for (const c of centres) {
    await bootstrapCentreCatalog(c.id);
    const t = await prisma.scoringTemplate.findMany({
      where: { centreId: c.id },
      orderBy: { levelKey: "asc" },
      select: { levelKey: true, levelName: true, passThreshold: true },
    });
    console.log(`✓ ${c.name}: ${t.map((x) => `${x.levelKey}:${x.levelName}(${x.passThreshold})`).join(" | ")}`);
  }
  console.log(`Done — ${centres.length} club(s) backfilled.`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
