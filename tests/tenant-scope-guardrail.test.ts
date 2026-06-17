// Guardrail for the bug class that broke /injuries (#110): tenantWhere() emits a
// `centre: { orgId }` relation filter, which Prisma only accepts on models that
// declare `centre Centre @relation`. A model with a `centreId` *scalar* but no
// relation crashes at runtime the moment tenantWhere() is applied to it — and
// TypeScript never catches it (the helper's return type is hand-written).
//
// This test introspects prisma/schema.prisma, finds every model with a centreId
// column but no centre relation, and locks that set to a known allowlist. So:
//   • adding a new centre-column model without the relation → fails here
//   • stripping the relation off a centre-owned model (e.g. regressing
//     InjuryLog/Team) → fails here
//   • giving an allowlisted model the relation → fails here (remove it from the
//     allowlist; it's now safe with tenantWhere)
// No DB needed — pure static analysis of the schema file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const schema = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "schema.prisma"),
  "utf8",
);

function modelBlocks(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ name: m[1], body: m[2] });
  return out;
}

const blocks = modelBlocks(schema);

const hasCentreId = (body: string) => /^\s*centreId\s+String/m.test(body);
const hasCentreRelation = (body: string) => /\bcentre\s+Centre\s+@relation/.test(body);

// Models that intentionally carry a centreId scalar WITHOUT a `centre` relation.
// These are scoped some other way (centreWhere() / explicit org-resolution / a
// relation other than `centre`) and must NOT be filtered with tenantWhere().
// If you give one of these a `centre` relation, remove it from this list.
const KNOWN_UNRELATED = [
  "ApprovalRequest",
  "Consumable",
  "Course",
  "FacilityBooking",
  "FarrierVisit",
  "HorseHealthLog",
  "Notification",
  "SeparationNotice",
  "StaffCertification",
  "User",
  "VaccinationSchedule",
].sort();

describe("tenantWhere centre-relation guardrail", () => {
  it("parsed the schema (sanity)", () => {
    expect(blocks.length).toBeGreaterThan(50);
  });

  const offenders = blocks
    .filter((b) => hasCentreId(b.body) && !hasCentreRelation(b.body))
    .map((b) => b.name)
    .sort();
  const allow = new Set(KNOWN_UNRELATED);

  it("no NEW model has a centreId without a `centre` relation", () => {
    const unexpected = offenders.filter((m) => !allow.has(m));
    expect(
      unexpected,
      `Model(s) [${unexpected.join(", ")}] have a centreId column but no \`centre Centre @relation\`. ` +
        `tenantWhere()'s \`centre: { orgId }\` filter will throw "Unknown argument centre" at runtime ` +
        `if applied to them (this is what crashed /injuries in #110). Fix: add the relation ` +
        `(preferred for centre-owned tables) — or, if intentionally org-bound and never used with ` +
        `tenantWhere(), add the model to KNOWN_UNRELATED in this test.`,
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const nowSafe = KNOWN_UNRELATED.filter((m) => !offenders.includes(m));
    expect(
      nowSafe,
      `Model(s) [${nowSafe.join(", ")}] are in KNOWN_UNRELATED but now HAVE a \`centre\` relation ` +
        `(or no longer exist). Remove them from the allowlist — they're safe with tenantWhere() now.`,
    ).toEqual([]);
  });

  it("InjuryLog and Team keep their centre relation (regression lock for #110)", () => {
    for (const name of ["InjuryLog", "Team"]) {
      const b = blocks.find((x) => x.name === name);
      expect(b, `${name} model not found in schema`).toBeTruthy();
      expect(hasCentreRelation(b!.body), `${name} lost its \`centre Centre @relation\``).toBe(true);
    }
  });
});
