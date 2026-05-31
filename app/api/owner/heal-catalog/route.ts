// One-shot heal endpoint. Brings ExamLevel + ScoringTemplate on
// production in line with the canonical prisma/equiwings-level-rubrics.json
// (Level 1-4 with the Equiwings exam-paper rubric).
//
// What it does:
//   1. UPSERTs the 4 general-discipline ExamLevel rows (Level 1..4)
//      with the new defaultRubricJson. Existing rows get renamed in
//      place via the (discipline, code) unique key.
//   2. Hard-deletes orphan "Expert" / "Level 5" general row if present.
//   3. UPSERTs ScoringTemplate (levelKey=1..4) for every centre with the
//      new categoriesJson + levelName + passThreshold.
//
// Idempotent — running it twice produces the same end state.
//
// TEMP: This endpoint exists ONLY to migrate the production tenants once.
// Slated for removal in the next commit after the user confirms /exams/levels
// shows Level 1..4 and the new rubric.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import fs from "node:fs";
import path from "node:path";

type RubricCategory = { name: string; items: unknown[] };
type CanonRubric = { levelName: string; passThreshold: number; categories: RubricCategory[] };

function loadRubrics(): Record<string, CanonRubric> {
  const p = path.join(process.cwd(), "prisma", "equiwings-level-rubrics.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export async function POST() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "OWNER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const rubrics = loadRubrics();
  const report = {
    examLevelsUpserted: 0,
    examLevelsDeleted: 0,
    centresProcessed: 0,
    scoringTemplatesUpserted: 0,
  };

  // 1. ExamLevel — general discipline only. Codes "1".."4" match the
  // rubric keys; orderIndex mirrors code.
  for (const code of ["1", "2", "3", "4"]) {
    const r = rubrics[code];
    if (!r) continue;
    const orderIndex = Number(code);
    await prisma.examLevel.upsert({
      where: { discipline_code: { discipline: "general", code } },
      create: {
        discipline: "general",
        code,
        name: r.levelName,
        orderIndex,
        passThreshold: r.passThreshold,
        defaultRubricJson: r.categories as Prisma.InputJsonValue,
        active: true,
      },
      update: {
        name: r.levelName,
        orderIndex,
        passThreshold: r.passThreshold,
        defaultRubricJson: r.categories as Prisma.InputJsonValue,
        active: true,
      },
    });
    report.examLevelsUpserted += 1;
  }

  // 2. Remove orphan "Expert" / code=5 row from the old seed if it's still
  // around. ScoringTemplate.examLevelId is onDelete: SetNull so this is safe.
  const stale = await prisma.examLevel.deleteMany({
    where: { discipline: "general", code: "5" },
  });
  report.examLevelsDeleted = stale.count;

  // 3. ScoringTemplate — per centre, upsert Level 1-4 with new rubric.
  const centres = await prisma.centre.findMany({ select: { id: true } });
  for (const c of centres) {
    report.centresProcessed += 1;
    for (const code of ["1", "2", "3", "4"]) {
      const r = rubrics[code];
      if (!r) continue;
      // Resolve the ExamLevel id so the soft FK on ScoringTemplate.examLevelId
      // points at the right canonical row.
      const exam = await prisma.examLevel.findUnique({
        where: { discipline_code: { discipline: "general", code } },
        select: { id: true },
      });
      const data = {
        levelName: r.levelName,
        passThreshold: r.passThreshold,
        categoriesJson: r.categories as Prisma.InputJsonValue,
        examLevelId: exam?.id ?? null,
      };
      await prisma.scoringTemplate.upsert({
        where: { centreId_levelKey: { centreId: c.id, levelKey: code } },
        create: { centreId: c.id, levelKey: code, ...data },
        update: data,
      });
      report.scoringTemplatesUpserted += 1;
    }
  }

  return NextResponse.json({ ok: true, ...report });
}
