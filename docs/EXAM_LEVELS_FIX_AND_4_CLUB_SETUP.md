# Exam Levels Fix + 4-Club (Multi-Tenant) Exam Module Setup

**Scope of this document**
1. **Fix the wrong exam levels** every club is getting today.
2. **Import the correct level/rubric data** (the canonical Equiwings 4-level
   rubric) into the CMS so it's what clubs actually score against.
3. **Stand up 4 clubs, each with its own separate exam module** (centre-scoped
   levels, templates, exams, examiners/jury).

> **Out of scope:** rider/student data is **NOT** migrated. Only the exam
> levels/rubrics are corrected and imported. Riders are entered/managed in each
> club directly.

---

## Part A — The bug: levels are wrong in every club

### A.1 Root cause

The CMS has **two different rubric definitions**, and the exam scorer reads the
**wrong one**:

| Source | What it defines | Used by | Correct? |
|--------|-----------------|---------|----------|
| `prisma/equiwings-level-rubrics.json` | Canonical **4 levels** — Level 1 Beginner, 2 Elementary, 3 Intermediate, 4 Advanced; pass **70**; real rubric (Dress Code, Know Your Horse, Parts of Saddle, …, select + text categories) | `prisma/seed.ts` → `ExamLevel.defaultRubricJson` (catalog only) | ✅ correct |
| `lib/centre-bootstrap.ts` (`LEVEL_1_RUBRIC`, `LEVEL_2_RUBRIC`) | Only **2** generic placeholder levels: "Level 1 — Beginner" (pass **60**) and "Level 2 — **Intermediate**" (pass **65**) with placeholder items ("Helmet (ASTM/ISI certified)", "Gloves", "Seat", "Hands & contact") | **`ScoringTemplate`** rows per centre | ❌ wrong |

The scorer (`app/api/exams/[id]/score/route.ts`) and the rubric used to display/
total an exam come from **`ScoringTemplate`**:

```ts
const template = await prisma.scoringTemplate.findUnique({
  where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
});
```

`ScoringTemplate` rows are created by **`bootstrapCentreCatalog()`** in
`lib/centre-bootstrap.ts`, which is called for every new club from:
- `app/api/centres/route.ts:47` (admin creates a club)
- `lib/tenant-provision.ts:106` (tenant self-signup)

…and that function only writes the **2 generic levels**. So the correct 4-level
rubric in `equiwings-level-rubrics.json` / `ExamLevel.defaultRubricJson` is
**never used for actual scoring**.

### A.2 What a club sees today (symptoms)

- Only **Levels 1 and 2** exist as scorable templates — **Levels 3 & 4 missing**.
- **Level 2 is mislabeled** "Intermediate" (should be "Elementary").
- Pass thresholds are **60 / 65** instead of **70**.
- Rubric items are generic placeholders, not the real Equiwings rubric
  (no "Dress Code / Helmet / Breeches", "Know Your Horse", "Parts of Saddle",
  "Miscellaneous Questions", "Objective …" select, "Remarks by Jury" text).

### A.3 Canonical source of truth

`prisma/equiwings-level-rubrics.json` — verified shape:

| Key | levelName | pass | categories |
|-----|-----------|------|------------|
| `"1"` | Level 1 — Beginner | 70 | 8 (6 numeric + 1 select + 1 text) |
| `"2"` | Level 2 — Elementary | 70 | 8 |
| `"3"` | Level 3 — Intermediate | 70 | 8 |
| `"4"` | Level 4 — Advanced | 70 | 8 |

This file is already loaded by `seed.ts` (into `ExamLevel.defaultRubricJson`). The
fix makes `bootstrapCentreCatalog()` use the **same file** as the single source
of truth for the per-centre `ScoringTemplate` rows.

---

## Part B — The fix (bootstrap + backfill)

### B.1 Patch `lib/centre-bootstrap.ts`

Replace the two hardcoded `LEVEL_1_RUBRIC` / `LEVEL_2_RUBRIC` constants and the
two `scoringTemplate.upsert` calls with a loop over **all 4 canonical levels**,
read from `equiwings-level-rubrics.json`.

**1. Add the canonical loader near the top of the file:**

```ts
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
```

**2. Delete** the `LEVEL_1_RUBRIC` and `LEVEL_2_RUBRIC` literals (no longer used).

**3. Replace** the two `scoringTemplate.upsert` blocks inside
`bootstrapCentreCatalog()` with this loop:

```ts
// Scoring templates — all 4 canonical Equiwings levels. update payload is
// populated (not `{}`) so re-running the bootstrap repairs any club that was
// seeded with the old generic 2-level rubric.
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
    update: data, // ← repairs existing wrong rows on re-run
  });
}
```

> **Why `update: data` matters:** the current code uses `update: {}`, so simply
> re-running bootstrap on an existing club would **not** fix its wrong templates.
> Populating `update` makes the bootstrap idempotent *and* self-healing.

After this patch, **every newly created club** (via `/api/centres` or tenant
signup) automatically gets the correct 4 levels.

### B.2 Backfill existing clubs

Existing clubs already have the wrong rows. Run a one-time script to overwrite
them. Because the patched bootstrap is now self-healing, the backfill can simply
call it for every centre.

Create `scripts/backfill-exam-levels.ts`:

```ts
// Run: npx tsx scripts/backfill-exam-levels.ts
import { prisma } from "../lib/prisma";
import { bootstrapCentreCatalog } from "../lib/centre-bootstrap";

async function main() {
  const centres = await prisma.centre.findMany({ select: { id: true, name: true } });
  for (const c of centres) {
    await bootstrapCentreCatalog(c.id); // idempotent; repairs ScoringTemplate rows
    const n = await prisma.scoringTemplate.count({ where: { centreId: c.id } });
    console.log(`✓ ${c.name}: ${n} scoring templates`);
  }
  console.log(`Done — ${centres.length} club(s) backfilled.`);
}
main().finally(() => prisma.$disconnect());
```

> If you only want to touch templates (not re-seed fee plans/skills/consumables),
> replace the body of the loop with just the §B.1 template loop scoped to `c.id`.

Expect **4 templates per club** after running (levelKey 1–4).

### B.3 (Optional) align `ExamLevel.defaultRubricJson`

`seed.ts` already seeds the 4 general `ExamLevel` rows from the canonical file —
no change needed there. The fix above brings `ScoringTemplate` (what the scorer
reads) into line with it. The two are now sourced from the **same JSON file**.

---

## Part C — 4 clubs, each with its own separate exam module

The CMS is already **multi-tenant**: a "club" is a `Centre`, and the exam module
is **centre-scoped** end-to-end. Standing up 4 clubs gives each one its own,
isolated exam module automatically.

### C.1 What is isolated per club (centre-scoped)

| Model | Scope key | Meaning per club |
|-------|-----------|------------------|
| `ScoringTemplate` | `@@unique([centreId, levelKey])` | Each club has its **own** 4 level rubrics; it can customize them without affecting other clubs |
| `Exam` | `centreId` | Exams belong to one club; cross-centre read blocked (`FORBIDDEN_CROSS_CENTRE`) |
| `ExamSitting` | `centreId` | Sitting groups per club |
| `Rider` | `centreId` | Riders belong to one club (entered in-app — **not migrated**) |
| `User` (EXAMINER / JURY / CENTRE_MANAGER) | `centreId` | Staff scoped to their club; `SUPER_ADMIN`/`ADMIN` see all |
| `ProgressLevel`, `Skill`, `FeePlan`, `Consumable` | `centreId` | Seeded per club by `bootstrapCentreCatalog()` |

A `CENTRE_MANAGER` / `EXAMINER` / `JURY` only ever sees their own club's exam
module. `getSession()` enforces this; the score route additionally blocks
cross-centre access.

### C.2 Create the 4 clubs

Each `prisma.centre.create` / `POST /api/centres` call runs the **patched**
`bootstrapCentreCatalog()`, so each club is born with the correct 4 levels.

Option 1 — **Admin UI / API** (recommended for production):
`POST /api/centres` with the club name → centre created + catalog bootstrapped.
Repeat for all 4 clubs.

Option 2 — **Script** (repeatable env setup), `scripts/create-4-clubs.ts`:

```ts
// Run: npx tsx scripts/create-4-clubs.ts
import { prisma } from "../lib/prisma";
import { bootstrapCentreCatalog } from "../lib/centre-bootstrap";

// ── Set your 4 real club names / cities here ──────────────────────────────
const CLUBS = [
  { name: "Club 1", slug: "club-1", city: "—" },
  { name: "Club 2", slug: "club-2", city: "—" },
  { name: "Club 3", slug: "club-3", city: "—" },
  { name: "Club 4", slug: "club-4", city: "—" },
];

async function main() {
  for (const c of CLUBS) {
    const centre = await prisma.centre.upsert({
      where: { slug: c.slug },           // adjust to your Centre unique field
      create: { name: c.name, slug: c.slug /*, orgId, city, … per your schema */ },
      update: { name: c.name },
    });
    await bootstrapCentreCatalog(centre.id); // correct 4 levels seeded here
    const n = await prisma.scoringTemplate.count({ where: { centreId: centre.id } });
    console.log(`✓ ${c.name} (${centre.id}): ${n} levels`);
  }
}
main().finally(() => prisma.$disconnect());
```

> Check the `Centre` model in `prisma/schema.prisma` for required fields
> (`orgId`, `slug`, address, etc.) and mirror what `POST /api/centres` /
> `seed.ts:359` supplies — those are the authoritative examples of a valid
> centre payload.

### C.3 Per-club exam-module checklist

For each of the 4 clubs, after creation:
1. **4 levels present** — `ScoringTemplate` count = 4, levelKeys 1–4, names
   Beginner/Elementary/Intermediate/Advanced, pass 70.
2. **Assign staff** — create `EXAMINER` / `JURY` / `CENTRE_MANAGER` users with
   that club's `centreId`.
3. **Enter riders** in-app (not migrated).
4. (Optional) **Customize** a level for that club via the templates editor
   (`app/(admin)/exams/templates/`) — changes stay scoped to that club.

---

## Part D — Verification

Run after applying Part B and creating the clubs:

```bash
# Each club should report 4 templates, levelKeys 1–4, pass 70.
npx tsx -e '
import { prisma } from "./lib/prisma";
(async () => {
  for (const c of await prisma.centre.findMany({ select:{ id:true, name:true }})) {
    const t = await prisma.scoringTemplate.findMany({
      where:{ centreId:c.id }, orderBy:{ levelKey:"asc" },
      select:{ levelKey:true, levelName:true, passThreshold:true }});
    console.log(c.name, t.map(x=>`${x.levelKey}:${x.levelName}(${x.passThreshold})`).join(" | "));
  }
  await prisma.$disconnect();
})();'
```

Expected per club:
```
<Club>  1:Level 1 — Beginner(70) | 2:Level 2 — Elementary(70) | 3:Level 3 — Intermediate(70) | 4:Level 4 — Advanced(70)
```

Checklist:
- [ ] `lib/centre-bootstrap.ts` seeds 4 levels from `equiwings-level-rubrics.json`, `update` payload populated.
- [ ] `LEVEL_1_RUBRIC` / `LEVEL_2_RUBRIC` literals removed.
- [ ] Backfill script run — every existing club shows 4 correct templates.
- [ ] 4 clubs created, each with its own 4 levels.
- [ ] A test exam at **Level 3** and **Level 4** can be scheduled and scored in each club (was impossible before — those levels didn't exist).
- [ ] Level 2 reads **"Elementary"**, pass threshold **70** everywhere.
- [ ] No rider data migrated (per scope).

---

## Files touched

| File | Change |
|------|--------|
| `lib/centre-bootstrap.ts` | Seed 4 canonical levels from JSON; populate `update`; drop generic literals (Part B.1) |
| `scripts/backfill-exam-levels.ts` | **New** — repair existing clubs (Part B.2) |
| `scripts/create-4-clubs.ts` | **New** — stand up the 4 clubs (Part C.2) |
| `prisma/equiwings-level-rubrics.json` | Unchanged — already canonical; now the single source for both `ExamLevel` and `ScoringTemplate` |

No schema migration is required — `ScoringTemplate`, `Centre`, and the exam
models already exist and are centre-scoped.
