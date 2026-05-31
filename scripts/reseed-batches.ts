// Replace every centre's batches with the four standard templates:
//   MWF Morning  — Mon,Wed,Fri  06:00–07:30
//   MWF Evening  — Mon,Wed,Fri  16:30–18:00
//   TTS Morning  — Tue,Thu,Sat  06:00–07:30
//   TTS Evening  — Tue,Thu,Sat  16:30–18:00
//
// Usage:
//   npx tsx scripts/reseed-batches.ts            # dry-run; prints the plan, mutates nothing
//   npx tsx scripts/reseed-batches.ts --apply    # actually writes
//
// DESTRUCTIVE on --apply. For each centre, in a transaction:
//   1. null-out Rider.batchId  (riders preserved, lose their assignment)
//   2. null-out Lesson.batchId (lessons preserved, decoupled from batch)
//   3. delete every Attendance row whose batch belongs to this centre
//   4. delete every BatchShiftRequest whose toBatch / fromBatch is in this centre
//   5. delete every Batch in this centre
//   6. insert the 4 standard batches
//
// User confirmed (2026-05-31) the existing data is test-only, so the
// attendance + shift-request wipe is intentional. If/when this script is
// reused against real data, add a centre-scope filter (e.g. only centres
// with zero attendance rows) or branch on Organisation.status.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type BatchSeed = {
  name: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
};

const SEEDS: BatchSeed[] = [
  { name: "MWF Morning", dayOfWeek: "Mon,Wed,Fri", startTime: "06:00", endTime: "07:30" },
  { name: "MWF Evening", dayOfWeek: "Mon,Wed,Fri", startTime: "16:30", endTime: "18:00" },
  { name: "TTS Morning", dayOfWeek: "Tue,Thu,Sat", startTime: "06:00", endTime: "07:30" },
  { name: "TTS Evening", dayOfWeek: "Tue,Thu,Sat", startTime: "16:30", endTime: "18:00" },
];

async function main() {
  const apply = process.argv.includes("--apply");

  const centres = await prisma.centre.findMany({
    select: { id: true, slug: true, name: true, org: { select: { name: true, status: true } } },
    orderBy: [{ org: { name: "asc" } }, { name: "asc" }],
  });

  if (centres.length === 0) {
    console.log("No centres found — nothing to do.");
    return;
  }

  console.log(apply ? "APPLY mode — writes will happen.\n" : "DRY RUN — nothing will be written. Re-run with --apply to execute.\n");

  let totalBatchesDeleted = 0;
  let totalAttendanceDeleted = 0;
  let totalShiftReqsDeleted = 0;
  let totalRidersUnassigned = 0;
  let totalLessonsUnassigned = 0;
  let totalBatchesCreated = 0;

  for (const c of centres) {
    const [batchCount, attendanceCount, shiftReqCount, ridersAssigned, lessonsAssigned] = await Promise.all([
      prisma.batch.count({ where: { centreId: c.id } }),
      prisma.attendance.count({ where: { batch: { centreId: c.id } } }),
      prisma.batchShiftRequest.count({
        where: { OR: [{ toBatch: { centreId: c.id } }, { fromBatch: { centreId: c.id } }] },
      }),
      prisma.rider.count({ where: { centreId: c.id, batchId: { not: null } } }),
      prisma.lesson.count({ where: { batchId: { not: null }, batch: { centreId: c.id } } }),
    ]);

    console.log(`▸ ${c.org?.name ?? "(no org)"} / ${c.name}  (${c.slug})`);
    console.log(
      `    delete  batches:${batchCount}  attendance:${attendanceCount}  shiftReqs:${shiftReqCount}` +
      `   null  riders:${ridersAssigned}  lessons:${lessonsAssigned}` +
      `   create batches:${SEEDS.length}`,
    );

    if (!apply) {
      totalBatchesDeleted += batchCount;
      totalAttendanceDeleted += attendanceCount;
      totalShiftReqsDeleted += shiftReqCount;
      totalRidersUnassigned += ridersAssigned;
      totalLessonsUnassigned += lessonsAssigned;
      totalBatchesCreated += SEEDS.length;
      continue;
    }

    // Wrap per-centre changes in a transaction so a mid-flight failure
    // doesn't leave dangling FK state. One transaction per centre rather
    // than one over all centres so the script can make partial progress
    // if one centre trips a constraint.
    const result = await prisma.$transaction(async (tx) => {
      const ridersR = await tx.rider.updateMany({
        where: { centreId: c.id, batchId: { not: null } },
        data: { batchId: null },
      });
      const lessonsR = await tx.lesson.updateMany({
        where: { batchId: { not: null }, batch: { centreId: c.id } },
        data: { batchId: null },
      });
      const attendanceR = await tx.attendance.deleteMany({
        where: { batch: { centreId: c.id } },
      });
      const shiftReqsR = await tx.batchShiftRequest.deleteMany({
        where: { OR: [{ toBatch: { centreId: c.id } }, { fromBatch: { centreId: c.id } }] },
      });
      const batchesR = await tx.batch.deleteMany({ where: { centreId: c.id } });
      for (const seed of SEEDS) {
        await tx.batch.create({
          data: {
            centreId: c.id,
            name: seed.name,
            dayOfWeek: seed.dayOfWeek,
            startTime: seed.startTime,
            endTime: seed.endTime,
            // coachId + level intentionally null — centre manager fills in.
          },
        });
      }
      return {
        batchesDeleted: batchesR.count,
        attendanceDeleted: attendanceR.count,
        shiftReqsDeleted: shiftReqsR.count,
        ridersUnassigned: ridersR.count,
        lessonsUnassigned: lessonsR.count,
      };
    });

    console.log(`    ✓ done`);
    totalBatchesDeleted += result.batchesDeleted;
    totalAttendanceDeleted += result.attendanceDeleted;
    totalShiftReqsDeleted += result.shiftReqsDeleted;
    totalRidersUnassigned += result.ridersUnassigned;
    totalLessonsUnassigned += result.lessonsUnassigned;
    totalBatchesCreated += SEEDS.length;
  }

  console.log("");
  console.log("── Summary ──");
  console.log(`Centres processed:      ${centres.length}`);
  console.log(`Batches deleted:        ${totalBatchesDeleted}`);
  console.log(`Attendance rows wiped:  ${totalAttendanceDeleted}`);
  console.log(`Shift requests wiped:   ${totalShiftReqsDeleted}`);
  console.log(`Riders unassigned:      ${totalRidersUnassigned}`);
  console.log(`Lessons unassigned:     ${totalLessonsUnassigned}`);
  console.log(`Batches created:        ${totalBatchesCreated}  (${SEEDS.length} per centre)`);
  if (!apply) {
    console.log("");
    console.log("Re-run with --apply to execute.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
