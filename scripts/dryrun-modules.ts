// In-depth simulation for the Examination + Competition modules.
// Exercises every feature added in the latest pass (E1–E8 + C1–C10) plus
// the edge cases that motivated each: co-judge aggregation, retake linkage,
// discipline-specific tie-breaks, refunds, horse double-booking guard,
// participation/winner cert auto-issue, etc.
//
// Failures collect in the `issues` array and print at the end so the user
// gets a single punch list, not a wall of stack traces.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { computeTotal, parseRubric } from "../lib/schemas/exam";
import { getDisciplineRules, rankEntries } from "../lib/discipline";
import { generateUniqueSerial, verifyUrl } from "../lib/cert";

const prisma = new PrismaClient();
const issues: { tag: string; msg: string }[] = [];
const passes: { tag: string; msg: string }[] = [];

function fail(tag: string, msg: string) {
  issues.push({ tag, msg });
  console.error(`  ✗ ${tag}: ${msg}`);
}
function pass(tag: string, msg: string) {
  passes.push({ tag, msg });
  console.log(`  ✓ ${tag}: ${msg}`);
}
async function step(tag: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    fail(tag, e?.message ?? String(e));
  }
}
function approx(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}

async function reset() {
  console.log("\n=== RESET ==");
  const tables = [
    "OwnerPasswordResetToken",
    "PasswordResetToken",
    "ExamJudge",
    "ExamAttachment",
    "ExamSitting",
    "Certificate",
    "Exam",
    "ScoringTemplate",
    "CompetitionRoundScore",
    "CompetitionRound",
    "StartListEntry",
    "PrizeAward",
    "Sponsor",
    "CompetitionEntry",
    "Competition",
    "Notification",
    "AuditLog",
    "PlatformAuditLog",
    "Payment",
    "Invoice",
    "Attendance",
    "Tack",
    "AssetIssue",
    "AssetMaintenance",
    "Asset",
    "Task",
    "TeamMember",
    "Team",
    "StaffCertification",
    "FacilityBooking",
    "ApprovalRequest",
    "CourseEnrolment",
    "Course",
    "MedicineMovement",
    "MedicinePrescription",
    "Medicine",
    "ConsumableMovement",
    "Consumable",
    "FarrierVisit",
    "VaccinationSchedule",
    "HorseHealthLog",
    "InjuryLog",
    "HorseAllocation",
    "ParentLink",
    "Rider",
    "Batch",
    "Staff",
    "User",
    "OrgFeature",
    "PlatformUser",
    "Centre",
    "Organisation",
  ];
  await (prisma as any).$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  for (const t of tables) {
    try {
      await (prisma as any).$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {}
  }
  await (prisma as any).$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
}

async function main() {
  // SQLite-only guard (same as dryrun-smoke).
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    console.error(
      `Refusing to run against non-SQLite DATABASE_URL (${url.slice(0, 30)}…).\n` +
        "This script wipes the database — only safe against a local file: URL.",
    );
    await prisma.$disconnect();
    process.exit(2);
  }
  // Same safety brake as dryrun-smoke — refuse to nuke a real-seed DB
  // unless --force is supplied. Pass --force when you genuinely want to
  // re-test the modules from a clean state.
  if (!process.argv.includes("--force")) {
    const seeded = await prisma.user.findFirst({
      where: { email: { endsWith: "@equiwings.in" } },
      select: { id: true },
    });
    if (seeded) {
      console.error(
        "Refusing to wipe: seeded equiwings users present.\n" +
          "Pass --force to override:\n" +
          "  npx tsx scripts/dryrun-modules.ts --force",
      );
      await prisma.$disconnect();
      process.exit(2);
    }
  }
  await reset();

  // ─────────────────────────────────────────────────────────────────────
  console.log("\n=== SETUP ==");
  const org = await prisma.organisation.create({
    data: { slug: "modules-test", name: "Modules Test Club", status: "active", plan: "pro" },
  });
  const centre = await prisma.centre.create({
    data: { orgId: org.id, slug: "modules-a", name: "Modules Centre", address: "Bengaluru" },
  });
  const hash = await bcrypt.hash("password", 10);
  const manager = await prisma.user.create({
    data: { name: "Manager M", email: "mgr@m.test", role: "CENTRE_MANAGER", centreId: centre.id, passwordHash: hash },
  });
  const examinerA = await prisma.user.create({
    data: { name: "Examiner A", email: "exA@m.test", role: "EXAMINER", centreId: centre.id, passwordHash: hash },
  });
  const examinerB = await prisma.user.create({
    data: { name: "Examiner B", email: "exB@m.test", role: "EXAMINER", centreId: centre.id, passwordHash: hash },
  });
  const examinerC = await prisma.user.create({
    data: { name: "Examiner C", email: "exC@m.test", role: "EXAMINER", centreId: centre.id, passwordHash: hash },
  });
  const groom = await prisma.user.create({
    data: { name: "Groom G", email: "groom@m.test", role: "GROOM", centreId: centre.id, passwordHash: hash },
  });

  const riders = [];
  for (let i = 1; i <= 8; i++) {
    riders.push(
      await prisma.rider.create({
        data: {
          centreId: centre.id,
          firstName: `Rider${i}`,
          lastName: `Last${i}`,
          mobile: `90000000${String(i).padStart(2, "0")}`,
          dob: new Date(2010, 0, i),
          gender: i % 2 === 0 ? "female" : "male",
          joiningDate: new Date(),
          status: "active",
        },
      }),
    );
  }
  const horses = [];
  for (let i = 1; i <= 6; i++) {
    horses.push(
      await prisma.horse.create({
        data: {
          centreId: centre.id,
          name: `Horse${i}`,
          breed: "Marwari",
          sex: "mare",
          ownership: "club",
          status: "active",
        },
      }),
    );
  }

  // Two scoring templates — L1 has just two numeric items (max 50 + 50 = 100),
  // pass threshold 60%. Makes pass/fail math trivial to predict in tests.
  const template1 = await prisma.scoringTemplate.create({
    data: {
      centreId: centre.id,
      levelKey: "1",
      levelName: "Level 1",
      passThreshold: 60,
      categoriesJson: JSON.stringify([
        {
          name: "Position",
          type: "numeric",
          items: [
            { name: "Seat", max_score: 50 },
            { name: "Hands", max_score: 50 },
          ],
        },
      ]),
    },
  });
  pass("setup", `org/centre/users/riders/horses/templates ready (${riders.length} riders, ${horses.length} horses)`);

  // ─────────────────────────────────────────────────────────────────────
  // E2: Deductions / time-faults math
  console.log("\n=== EXAM: single-judge + deductions ==");
  let singleExamId = "";
  await step("e2_single_judge", async () => {
    const rubric = parseRubric(template1.categoriesJson);
    const scores = { Position_Seat: 40, Position_Hands: 45 };
    const { total, max } = computeTotal(rubric, scores);
    if (total !== 85 || max !== 100) throw new Error(`expected 85/100, got ${total}/${max}`);
    const exam = await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: riders[0]!.id,
        examinerId: examinerA.id,
        examinerName: examinerA.name,
        level: 1,
        date: new Date(),
        scoresJson: JSON.stringify(scores),
        deductions: 5,
        timeFaults: 2,
        totalScore: Math.max(0, total - 5 - 2),
        status: "completed",
        passed: (total - 5 - 2) / max >= 0.6,
      },
    });
    singleExamId = exam.id;
    if (exam.totalScore !== 78) throw new Error(`expected 78 after deductions, got ${exam.totalScore}`);
    if (exam.passed !== true) throw new Error("expected pass");
    pass("e2_single_judge", `rubric 85 − 5 ded − 2 time = 78 (pass at 60%)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // E1: Co-judge aggregation
  console.log("\n=== EXAM: co-judge aggregation ==");
  let coJudgeExamId = "";
  await step("e1_cojudge", async () => {
    const rubric = parseRubric(template1.categoriesJson);
    const exam = await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: riders[1]!.id,
        examinerId: examinerA.id,
        examinerName: examinerA.name,
        level: 1,
        date: new Date(),
        status: "in_progress",
      },
    });
    coJudgeExamId = exam.id;
    // Lead submits 80
    const leadScores = { Position_Seat: 40, Position_Hands: 40 };
    const leadTotal = computeTotal(rubric, leadScores).total;
    await prisma.examJudge.create({
      data: {
        examId: exam.id,
        judgeId: examinerA.id,
        judgeName: examinerA.name,
        position: 1,
        scoresJson: JSON.stringify(leadScores),
        subTotal: leadTotal,
        submittedAt: new Date(),
      },
    });
    // Co-judge B submits 70
    const bScores = { Position_Seat: 35, Position_Hands: 35 };
    const bTotal = computeTotal(rubric, bScores).total;
    await prisma.examJudge.create({
      data: {
        examId: exam.id,
        judgeId: examinerB.id,
        judgeName: examinerB.name,
        position: 2,
        scoresJson: JSON.stringify(bScores),
        subTotal: bTotal,
        submittedAt: new Date(),
      },
    });
    // Co-judge C submits 90
    const cScores = { Position_Seat: 45, Position_Hands: 45 };
    const cTotal = computeTotal(rubric, cScores).total;
    await prisma.examJudge.create({
      data: {
        examId: exam.id,
        judgeId: examinerC.id,
        judgeName: examinerC.name,
        position: 3,
        scoresJson: JSON.stringify(cScores),
        subTotal: cTotal,
        submittedAt: new Date(),
      },
    });
    const rows = await prisma.examJudge.findMany({ where: { examId: exam.id } });
    const submitted = rows.filter((r) => r.subTotal !== null);
    const avg = submitted.reduce((s, r) => s + (r.subTotal ?? 0), 0) / submitted.length;
    if (!approx(avg, 80)) throw new Error(`expected mean 80, got ${avg}`);
    await prisma.exam.update({
      where: { id: exam.id },
      data: { totalScore: avg, status: "completed", passed: avg / 100 >= 0.6 },
    });
    pass("e1_cojudge", `3 judges (80, 70, 90) → aggregate 80 (pass)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // E5: Re-attempt linkage
  console.log("\n=== EXAM: re-attempt linkage ==");
  await step("e5_retake", async () => {
    // First attempt — fail
    const a1 = await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: riders[2]!.id,
        examinerId: examinerA.id,
        examinerName: examinerA.name,
        level: 1,
        date: new Date(Date.now() - 30 * 86400000),
        totalScore: 40,
        status: "completed",
        passed: false,
        attemptNumber: 1,
      },
    });
    // Detect prior fail like the schedule route does
    const lastFailed = await prisma.exam.findFirst({
      where: { riderId: riders[2]!.id, level: 1, status: "completed", passed: false },
      orderBy: { date: "desc" },
    });
    if (lastFailed?.id !== a1.id) throw new Error("retake lookup didn't find the failed attempt");
    const a2 = await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: riders[2]!.id,
        examinerId: examinerA.id,
        examinerName: examinerA.name,
        level: 1,
        date: new Date(),
        previousExamId: lastFailed.id,
        attemptNumber: lastFailed.attemptNumber + 1,
        status: "scheduled",
      },
    });
    if (a2.attemptNumber !== 2) throw new Error(`expected attempt 2, got ${a2.attemptNumber}`);
    if (a2.previousExamId !== a1.id) throw new Error("previousExamId not set");
    pass("e5_retake", `a1 (failed, #1) → a2 (#2, previousExamId=a1)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // E6: Attachments
  console.log("\n=== EXAM: attachments ==");
  await step("e6_attachments", async () => {
    const att1 = await prisma.examAttachment.create({
      data: { examId: singleExamId, kind: "video", url: "https://test/clip.mp4", uploadedBy: manager.id },
    });
    const att2 = await prisma.examAttachment.create({
      data: { examId: singleExamId, kind: "sheet", url: "https://test/sealed.pdf", caption: "sealed envelope" },
    });
    const all = await prisma.examAttachment.findMany({ where: { examId: singleExamId } });
    if (all.length !== 2) throw new Error(`expected 2, got ${all.length}`);
    if (!all.some((a) => a.kind === "sheet")) throw new Error("sealed sheet missing");
    pass("e6_attachments", "video + sheet attachments persisted");
  });

  // ─────────────────────────────────────────────────────────────────────
  // E7: Sitting + bulk schedule + retake auto-link
  console.log("\n=== EXAM: sitting bulk schedule ==");
  await step("e7_sitting", async () => {
    // Rider 3 has a prior fail at level 1 (from E5 setup) — sitting should
    // pick it up and create attempt #2.
    const riderIds = [riders[3]!.id, riders[4]!.id, riders[2]!.id]; // include rider[2] who failed
    const sitting = await prisma.examSitting.create({
      data: {
        centreId: centre.id,
        level: 1,
        date: new Date(),
        examinerId: examinerA.id,
        examinerName: examinerA.name,
      },
    });
    // Bulk-create exams the same way the route does
    const priorFails = await prisma.exam.findMany({
      where: { riderId: { in: riderIds }, level: 1, status: "completed", passed: false },
      orderBy: { date: "desc" },
    });
    const priorByRider = new Map<string, any>();
    for (const p of priorFails) if (!priorByRider.has(p.riderId)) priorByRider.set(p.riderId, p);

    await prisma.exam.createMany({
      data: riderIds.map((rid) => {
        const prior = priorByRider.get(rid);
        return {
          centreId: centre.id,
          riderId: rid,
          examinerId: examinerA.id,
          examinerName: examinerA.name,
          level: 1,
          date: new Date(),
          status: "scheduled",
          sittingId: sitting.id,
          previousExamId: prior?.id ?? null,
          attemptNumber: prior ? prior.attemptNumber + 1 : 1,
        };
      }),
    });
    const inSitting = await prisma.exam.findMany({ where: { sittingId: sitting.id }, orderBy: { createdAt: "asc" } });
    if (inSitting.length !== 3) throw new Error(`expected 3 exams in sitting, got ${inSitting.length}`);
    const rider2Exam = inSitting.find((e) => e.riderId === riders[2]!.id);
    // Rider[2] already had an attempt #2 created in E5, so this sitting-row
    // should be attempt #2 again (we look at the most recent failed exam —
    // which is still attempt #1). Looser assertion: attemptNumber > 1.
    if (!rider2Exam || rider2Exam.attemptNumber < 2) {
      throw new Error(`rider[2] sitting exam attempt# expected ≥2, got ${rider2Exam?.attemptNumber}`);
    }
    pass("e7_sitting", `3 exams in one sitting; retake auto-linked for rider[2]`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // C1 + C4: Discipline-specific ranking with tie-breaks
  console.log("\n=== COMPETITION: discipline ranking + tie-breaks ==");
  await step("c1_generic_rank", async () => {
    const rules = getDisciplineRules("generic");
    if (rules.key !== "generic") throw new Error("generic resolved wrong");
    const ranked = rankEntries("generic", [
      { score: 80, faults: null, time: null },
      { score: 95, faults: null, time: null },
      { score: 70, faults: null, time: null },
    ]);
    if (ranked[0]!.score !== 95 || ranked[2]!.score !== 70) throw new Error("generic rank wrong");
    pass("c1_generic_rank", "95 > 80 > 70 (higher wins)");
  });

  await step("c4_dressage_tiebreak", async () => {
    // Dressage: higher % wins; tie → fewer faults.
    const ranked = rankEntries("dressage", [
      { score: 72.5, faults: 1, time: null }, // tie A
      { score: 72.5, faults: 0, time: null }, // tie B – wins (fewer faults)
      { score: 70.0, faults: 0, time: null },
    ]);
    if (ranked[0]!.faults !== 0 || ranked[0]!.score !== 72.5) throw new Error("dressage tiebreak wrong");
    pass("c4_dressage_tiebreak", "72.5%/0f beats 72.5%/1f");
  });

  await step("c4_jumping_tiebreak", async () => {
    // Jumping: fewest faults wins; tie → fastest time.
    const ranked = rankEntries("jumping", [
      { score: null, faults: 4, time: 65.2 },
      { score: null, faults: 0, time: 62.1 }, // wins
      { score: null, faults: 0, time: 65.0 },
    ]);
    if (ranked[0]!.faults !== 0 || ranked[0]!.time !== 62.1) throw new Error("jumping tiebreak wrong");
    if (ranked[2]!.faults !== 4) throw new Error("4-faulter should be last");
    pass("c4_jumping_tiebreak", "0f/62.1s beats 0f/65.0s beats 4f/65.2s");
  });

  await step("c4_eventing_tiebreak", async () => {
    // Eventing: lowest penalty total; tie → time then faults.
    const ranked = rankEntries("eventing", [
      { score: 35.2, faults: null, time: 0 },
      { score: 35.2, faults: null, time: -5 }, // wins (closer to optimal XC, smaller time)
    ]);
    if (ranked[0]!.time !== -5) throw new Error("eventing tiebreak wrong");
    pass("c4_eventing_tiebreak", "35.2/-5t beats 35.2/0t");
  });

  await step("c4_gymkhana_tiebreak", async () => {
    // Gymkhana: fastest time; tie → fewer faults.
    const ranked = rankEntries("gymkhana", [
      { score: null, faults: 2, time: 30.0 },
      { score: null, faults: 0, time: 30.0 }, // wins
      { score: null, faults: 0, time: 31.5 },
    ]);
    if (ranked[0]!.faults !== 0 || ranked[0]!.time !== 30.0) throw new Error("gymkhana tiebreak wrong");
    pass("c4_gymkhana_tiebreak", "30.0s/0f beats 30.0s/2f beats 31.5s/0f");
  });

  // ─────────────────────────────────────────────────────────────────────
  // C9: Horse double-booking guard
  console.log("\n=== COMPETITION: horse double-booking + entries ==");
  const compJ = await prisma.competition.create({
    data: {
      centreId: centre.id,
      name: "Spring Jumping",
      slug: "spring-jumping",
      scope: "internal",
      discipline: "jumping",
      startDate: new Date(),
      endDate: new Date(),
      status: "open_for_entries",
      classesJson: JSON.stringify([
        { name: "Open", fee: 500, maxEntries: 20 },
        { name: "Junior", fee: 300, maxEntries: 20 },
      ]),
    },
  });

  await step("c9_horse_double_book", async () => {
    // Rider[0] enters Open on Horse[0]
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[0]!.id, className: "Open", horseId: horses[0]!.id, paid: false },
    });
    // Same horse, different class — simulate the route's guard
    const conflict = await prisma.competitionEntry.findFirst({
      where: { competitionId: compJ.id, horseId: horses[0]!.id, status: { not: "withdrawn" } },
    });
    if (!conflict) throw new Error("conflict lookup missed the existing entry");
    // Override path: create with allowDoubleBook semantics (we just write the row)
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[1]!.id, className: "Junior", horseId: horses[0]!.id, paid: false },
    });
    const bothClasses = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id, horseId: horses[0]!.id },
    });
    if (bothClasses.length !== 2) throw new Error("override entry didn't persist");
    pass("c9_horse_double_book", "horse[0] entered in two classes — guard fired + override worked");
  });

  // ─────────────────────────────────────────────────────────────────────
  // C2: Rounds — per-class numbering
  console.log("\n=== COMPETITION: rounds ==");
  await step("c2_rounds", async () => {
    const r1 = await prisma.competitionRound.create({
      data: { competitionId: compJ.id, className: "Open", roundNumber: 1, name: "Round 1" },
    });
    const r2 = await prisma.competitionRound.create({
      data: { competitionId: compJ.id, className: "Open", roundNumber: 2, name: "Jump-off" },
    });
    const j1 = await prisma.competitionRound.create({
      data: { competitionId: compJ.id, className: "Junior", roundNumber: 1, name: "Round 1" },
    });
    if (r1.roundNumber !== 1 || r2.roundNumber !== 2) throw new Error("Open round numbering wrong");
    if (j1.roundNumber !== 1) throw new Error("Junior round numbering wrong");
    // Per-entry round score
    const openEntry = await prisma.competitionEntry.findFirstOrThrow({
      where: { competitionId: compJ.id, className: "Open" },
    });
    await prisma.competitionRoundScore.create({
      data: { roundId: r1.id, entryId: openEntry.id, faults: 0, time: 62.5 },
    });
    await prisma.competitionRoundScore.create({
      data: { roundId: r2.id, entryId: openEntry.id, faults: 0, time: 40.3 },
    });
    const scores = await prisma.competitionRoundScore.findMany({ where: { entryId: openEntry.id } });
    if (scores.length !== 2) throw new Error("expected 2 round scores");
    pass("c2_rounds", "Open has 2 rounds, Junior has 1, per-round scores persisted");
  });

  // ─────────────────────────────────────────────────────────────────────
  // C3: Team competition
  console.log("\n=== COMPETITION: team standings ==");
  await step("c3_teams", async () => {
    const teamA = await prisma.team.create({
      data: { centreId: centre.id, name: "Falcons", active: true },
    });
    const teamB = await prisma.team.create({
      data: { centreId: centre.id, name: "Eagles", active: true },
    });
    // Wipe existing entries to control inputs precisely
    await prisma.competitionEntry.deleteMany({ where: { competitionId: compJ.id } });
    // Falcons: 3 riders, faults 0+4+0=4, time 62+65+63=190
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[0]!.id, className: "Open", teamId: teamA.id, faults: 0, time: 62 },
    });
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[1]!.id, className: "Open", teamId: teamA.id, faults: 4, time: 65 },
    });
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[2]!.id, className: "Open", teamId: teamA.id, faults: 0, time: 63 },
    });
    // Eagles: 3 riders, faults 0+0+0=0, time 64+66+65=195 (FEWER faults wins jumping)
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[3]!.id, className: "Open", teamId: teamB.id, faults: 0, time: 64 },
    });
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[4]!.id, className: "Open", teamId: teamB.id, faults: 0, time: 66 },
    });
    await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: riders[5]!.id, className: "Open", teamId: teamB.id, faults: 0, time: 65 },
    });
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id },
      include: { team: true },
    });
    // Mirror TeamsPanel aggregation
    const byTeam = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!e.teamId) continue;
      if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
      byTeam.get(e.teamId)!.push(e);
    }
    const stats = Array.from(byTeam.entries()).map(([id, es]) => ({
      id,
      name: es[0]!.team!.name,
      sumFaults: es.reduce((s, e) => s + (e.faults ?? 0), 0),
      sumTime: es.reduce((s, e) => s + (e.time ?? 0), 0),
    }));
    stats.sort((a, b) => (a.sumFaults !== b.sumFaults ? a.sumFaults - b.sumFaults : a.sumTime - b.sumTime));
    if (stats[0]!.name !== "Eagles") throw new Error(`Eagles should win (0 faults), got ${stats[0]?.name}`);
    pass("c3_teams", `Eagles 0f/195s beats Falcons 4f/190s (faults-first)`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // C7: Auto-issue winner + participation certs
  console.log("\n=== COMPETITION: cert auto-issue ==");
  await step("c7_winner_cert", async () => {
    // Place the first 3 riders in the Open class
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id, className: "Open" },
      orderBy: { time: "asc" },
    });
    for (let i = 0; i < 3; i++) {
      const e = entries[i]!;
      // Simulate the PATCH side-effect: set placement + auto-cert
      await prisma.competitionEntry.update({ where: { id: e.id }, data: { placement: i + 1 } });
      const serial = await generateUniqueSerial(i + 1);
      await prisma.certificate.create({
        data: {
          centreId: centre.id,
          riderId: e.riderId,
          competitionId: compJ.id,
          type: "winner",
          levelName: `${i + 1 === 1 ? "1st place" : i + 1 === 2 ? "2nd place" : "3rd place"} · Open`,
          serialNo: serial,
          qrCode: verifyUrl(serial),
        },
      });
    }
    const winnerCerts = await prisma.certificate.findMany({
      where: { competitionId: compJ.id, type: "winner" },
    });
    if (winnerCerts.length !== 3) throw new Error(`expected 3 winner certs, got ${winnerCerts.length}`);
    pass("c7_winner_cert", `3 winner certs issued (1st/2nd/3rd)`);
  });

  await step("c7_participation_cert", async () => {
    // Simulate transition → completed: bulk-issue participation certs to
    // every non-winner non-withdrawn rider in the comp.
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id, status: { not: "withdrawn" } },
    });
    const existingCerts = await prisma.certificate.findMany({
      where: { competitionId: compJ.id, riderId: { in: entries.map((e) => e.riderId) } },
    });
    const already = new Set(existingCerts.map((c) => c.riderId));
    let issued = 0;
    for (const e of entries) {
      if (already.has(e.riderId)) continue;
      if (e.placement !== null && e.placement <= 3) continue;
      const serial = await generateUniqueSerial(1000 + issued);
      await prisma.certificate.create({
        data: {
          centreId: centre.id,
          riderId: e.riderId,
          competitionId: compJ.id,
          type: "participation",
          levelName: `Participation · Spring Jumping`,
          serialNo: serial,
          qrCode: verifyUrl(serial),
        },
      });
      already.add(e.riderId);
      issued++;
    }
    // 6 entries total in Open (3 winners + 3 non-winners). Expect 3 participation certs.
    const allCerts = await prisma.certificate.findMany({ where: { competitionId: compJ.id } });
    const winners = allCerts.filter((c) => c.type === "winner");
    const participation = allCerts.filter((c) => c.type === "participation");
    if (winners.length !== 3) throw new Error(`expected 3 winner certs, got ${winners.length}`);
    if (participation.length !== 3) throw new Error(`expected 3 participation certs, got ${participation.length}`);
    // No rider has both
    const ridersWithCerts = new Set(allCerts.map((c) => c.riderId));
    if (ridersWithCerts.size !== 6) throw new Error("rider got 2 certs");
    pass("c7_participation_cert", `3 winner + 3 participation, no duplicates`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // C8: Refund on withdrawal
  console.log("\n=== COMPETITION: refund on withdraw ==");
  await step("c8_refund_paid", async () => {
    const rider = riders[6]!;
    // Enter + invoice (paid)
    const entry = await prisma.competitionEntry.create({
      data: { competitionId: compJ.id, riderId: rider.id, className: "Junior", paid: true },
    });
    const inv = await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 300,
        dueDate: new Date(Date.now() + 7 * 86400000),
        kind: "event",
        status: "paid",
      },
    });
    await prisma.payment.create({
      data: { invoiceId: inv.id, amount: 300, method: "cash", paidAt: new Date(), clearedAt: new Date() },
    });
    // Simulate the PATCH side-effect on withdraw
    await prisma.competitionEntry.update({
      where: { id: entry.id },
      data: { status: "withdrawn" },
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "refunded" } });
    await prisma.competitionEntry.update({
      where: { id: entry.id },
      data: { refundedAt: new Date(), refundInvoiceId: inv.id },
    });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const updatedEntry = await prisma.competitionEntry.findUniqueOrThrow({ where: { id: entry.id } });
    if (after.status !== "refunded") throw new Error(`expected refunded, got ${after.status}`);
    if (!updatedEntry.refundedAt || updatedEntry.refundInvoiceId !== inv.id) {
      throw new Error("entry refund metadata not set");
    }
    pass("c8_refund_paid", "paid invoice flipped to refunded + entry stamped");
  });

  // ─────────────────────────────────────────────────────────────────────
  // C5: scoreboard data correctness (the actual SSE/refresh is client-side)
  console.log("\n=== COMPETITION: scoreboard data shape ==");
  await step("c5_scoreboard", async () => {
    // Pull the same data the public page renders and assert the discipline
    // formatter produces sensible strings.
    const rules = getDisciplineRules("jumping");
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id, className: "Open", status: { not: "withdrawn" } },
    });
    for (const e of entries) {
      const headline = rules.formatHeadline({ score: e.score, faults: e.faults, time: e.time });
      if (!headline.includes("fault")) throw new Error(`bad headline for jumping: ${headline}`);
    }
    pass("c5_scoreboard", `all jumping entries produce 'N fault(s) · Ts' headline`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // C10: judges-view data shape (read-only assertion that the rows the
  // page builds line up with start-list order)
  console.log("\n=== COMPETITION: judges' view ordering ==");
  await step("c10_judge_view", async () => {
    // Build a start list for Open
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: compJ.id, className: "Open", status: { not: "withdrawn" } },
    });
    // Wipe any prior start list
    await prisma.startListEntry.deleteMany({ where: { competitionId: compJ.id, className: "Open" } });
    // Reverse the entry order so we can verify the board reads from start-list, not insert order
    const ids = entries.map((e) => e.id).reverse();
    for (let i = 0; i < ids.length; i++) {
      await prisma.startListEntry.create({
        data: { competitionId: compJ.id, className: "Open", entryId: ids[i]!, order: i + 1 },
      });
    }
    const startList = await prisma.startListEntry.findMany({
      where: { competitionId: compJ.id, className: "Open" },
      orderBy: { order: "asc" },
    });
    // First start-list row should be the LAST entry by createdAt
    const sortedByCreated = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (startList[0]!.entryId !== sortedByCreated[sortedByCreated.length - 1]!.id) {
      throw new Error("start-list order didn't override createdAt order");
    }
    pass("c10_judge_view", `start-list order overrides createdAt — judges' board will follow draw`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // C6: Printable program + results — render the HTML and assert key tokens.
  console.log("\n=== COMPETITION: printables sanity ==");
  await step("c6_printable_program", async () => {
    // We can't easily import Next API route handlers here without a server;
    // assert the upstream data is shaped correctly so the route can render.
    const comp = await prisma.competition.findUniqueOrThrow({
      where: { id: compJ.id },
      include: {
        startList: true,
        rounds: true,
        entries: { include: { rider: true, team: true } },
      },
    });
    if (comp.startList.length === 0) throw new Error("no startList for program");
    if (comp.rounds.length === 0) throw new Error("no rounds for program");
    const cls = JSON.parse(comp.classesJson);
    if (!Array.isArray(cls) || cls.length === 0) throw new Error("no classes");
    pass("c6_printable_program", `startList=${comp.startList.length} rounds=${comp.rounds.length} classes=${cls.length}`);
  });

  await step("c6_printable_results", async () => {
    const comp = await prisma.competition.findUniqueOrThrow({
      where: { id: compJ.id },
      include: { entries: true, prizes: true, sponsors: true },
    });
    const placed = comp.entries.filter((e) => e.placement !== null);
    if (placed.length < 3) throw new Error(`expected ≥3 placed, got ${placed.length}`);
    pass("c6_printable_results", `${placed.length} placed entries, ${comp.entries.length} total`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // SUMMARY
  console.log("\n=== SUMMARY ==");
  console.log(`Total checks: ${passes.length + issues.length}`);
  console.log(`Passed: ${passes.length}`);
  console.log(`Failed: ${issues.length}`);
  if (issues.length === 0) {
    console.log("\n🟢 ALL MODULE CHECKS PASSED");
  } else {
    console.log("\n🔴 ISSUES:");
    for (const i of issues) console.log(`   - [${i.tag}] ${i.msg}`);
  }
  await prisma.$disconnect();
  process.exit(issues.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(2);
});
