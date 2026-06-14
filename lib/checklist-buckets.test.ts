import { describe, it, expect } from "vitest";
import { bucketsBySection } from "./checklist-buckets";

type I = { id: string; section: string | null; orderIndex: number };

describe("bucketsBySection", () => {
  it("orders sections by their lowest orderIndex, not by label spelling", () => {
    // Seeded coach-checklist convention: "1 · …" / "2 · …" / "3 · …".
    const items: I[] = [
      { id: "a", section: "1 · Horses", orderIndex: 1 },
      { id: "b", section: "2 · Rider", orderIndex: 31 },
      { id: "c", section: "3 · Other", orderIndex: 34 },
      { id: "d", section: "1 · Horses", orderIndex: 2 },
    ];
    const out = bucketsBySection(items);
    expect(out.map(([s]) => s)).toEqual(["1 · Horses", "2 · Rider", "3 · Other"]);
    // Items within a bucket are orderIndex-sorted.
    expect(out[0][1].map((i) => i.id)).toEqual(["a", "d"]);
  });

  it("works for the editor's A/B convention too (A before B by orderIndex)", () => {
    const items: I[] = [
      { id: "b1", section: "B", orderIndex: 3 },
      { id: "a1", section: "A", orderIndex: 1 },
      { id: "a2", section: "A", orderIndex: 2 },
    ];
    expect(bucketsBySection(items).map(([s]) => s)).toEqual(["A", "B"]);
  });

  it("would have broken under the old A/B-hardcoded sort: a 2·-before-1· label still orders by index", () => {
    // Labels whose lexical order does NOT match document order — proves we sort
    // by orderIndex, not localeCompare.
    const items: I[] = [
      { id: "x", section: "Z-first", orderIndex: 1 },
      { id: "y", section: "A-second", orderIndex: 2 },
    ];
    expect(bucketsBySection(items).map(([s]) => s)).toEqual(["Z-first", "A-second"]);
  });

  it("buckets null sections under '—'", () => {
    const items: I[] = [
      { id: "a", section: null, orderIndex: 1 },
      { id: "b", section: null, orderIndex: 2 },
    ];
    const out = bucketsBySection(items);
    expect(out).toHaveLength(1);
    expect(out[0][0]).toBe("—");
    expect(out[0][1].map((i) => i.id)).toEqual(["a", "b"]);
  });
});
