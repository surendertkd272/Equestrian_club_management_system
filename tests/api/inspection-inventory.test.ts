// Inventory inspection: count against the register, and tell HQ.
//
// Two gaps this closes. The checklist was six generic prompts ("Saddles
// present & accounted for") that could be ticked without opening the tack
// room. And completing a run stamped a timestamp and stopped, so the point of
// a centre manager inspecting stock — that somebody above them hears the
// result — never happened.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { signSession } from "@/lib/auth";
import { summariseRun } from "@/lib/inspection-report";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: startRun } = await import("@/app/api/inspections/route");

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id,
      role: u.role as never,
      centreId: u.centreId,
      orgId: u.orgId ?? null,
      tokenVersion: 0,
      name: "T",
    } as never),
  });
}

const start = (scope: string) =>
  startRun(
    mockReq("http://localhost/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    }),
  );

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let manager: Awaited<ReturnType<typeof mkUser>>;

async function stockItem(name: string, unused: number, inUse: number, damaged = 0) {
  const cat = await prisma.equipmentCatalog.create({
    data: {
      code: `code_${name.toLowerCase().replace(/\W+/g, "_")}`,
      name,
      category: "tack",
      unit: "pair",
      defaultThreshold: 5,
      active: true,
    },
  });
  return prisma.equipmentStock.create({
    data: {
      centreId: centre.id,
      catalogId: cat.id,
      qtyUnused: unused,
      qtyInUse: inUse,
      qtyDamaged: damaged,
      qty: unused + inUse,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Inspect Club");
  centre = await mkCentre({ orgId: org.id, name: "Inspect Centre" });
  manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "mgr@i.in" });
});

describe("starting an inventory run", () => {
  it("seeds a line per stock item with the register quantity", async () => {
    await stockItem("Tendon Boots", 5, 3);
    await stockItem("Saddles", 10, 2);
    await signIn({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });

    const res = await start("inventory");
    expect(res.status).toBe(200);
    const { id } = await res.json();

    const items = await prisma.auditItem.findMany({ where: { runId: id } });
    expect(items).toHaveLength(2);
    const boots = items.find((i) => i.label.startsWith("Tendon Boots"))!;
    // 5 unused + 3 in use. Damaged is deliberately excluded — asking someone
    // to also find the broken ones turns a count into an inspection of the
    // scrap pile.
    expect(boots.expected).toBe(8);
    expect(boots.stockId).not.toBeNull();
  });

  it("excludes damaged stock from the expected count", async () => {
    await stockItem("Helmets", 4, 4, 4);
    await signIn({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    const { id } = await (await start("inventory")).json();
    const item = await prisma.auditItem.findFirstOrThrow({ where: { runId: id } });
    // A centre that "has" twelve helmets, four of them cracked, has eight.
    expect(item.expected).toBe(8);
  });

  it("falls back to the generic checklist when the centre holds no stock", async () => {
    await signIn({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    const { id } = await (await start("inventory")).json();
    const items = await prisma.auditItem.findMany({ where: { runId: id } });
    // Starting a run must never hand someone an empty sheet.
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.expected === null)).toBe(true);
  });

  it("leaves non-inventory scopes as pass/fail prompts", async () => {
    await stockItem("Rugs", 3, 1);
    await signIn({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    const { id } = await (await start("stable")).json();
    const items = await prisma.auditItem.findMany({ where: { runId: id } });
    // A stable check is not a count; forcing numbers onto it would be noise.
    expect(items.every((i) => i.expected === null)).toBe(true);
  });

  it("lets a centre manager start one at all", async () => {
    await signIn({ id: manager.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await start("inventory")).status).toBe(200);
  });

  it("refuses a coach", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@i.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await start("inventory")).status).toBe(403);
  });
});

describe("summarising a run for HQ", () => {
  it("reports the discrepancy, which is the whole point", () => {
    const s = summariseRun([
      { label: "Tendon Boots (pair)", result: "fail", expected: 8, counted: 1 },
      { label: "Saddles (piece)", result: "pass", expected: 12, counted: 12 },
      { label: "Helmets (piece)", result: "fail", expected: 10, counted: 9 },
    ]);
    expect(s.total).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.discrepancies).toHaveLength(2);
    // Biggest shortfall first — whoever reads this reads the top of the list.
    expect(s.discrepancies[0].label).toContain("Tendon Boots");
    expect(s.discrepancies[0].delta).toBe(-7);
    expect(s.netDelta).toBe(-8);
  });

  it("reports a clean run as clean", () => {
    const s = summariseRun([
      { label: "Saddles", result: "pass", expected: 12, counted: 12 },
      { label: "Exits clear", result: "pass", expected: null, counted: null },
    ]);
    expect(s.discrepancies).toHaveLength(0);
    expect(s.netDelta).toBe(0);
    expect(s.failed).toBe(0);
  });

  it("ignores lines that were never counted", () => {
    // An uncounted line is unknown, not a discrepancy. Reporting it as a
    // shortfall would send HQ chasing stock that is probably on the shelf.
    const s = summariseRun([
      { label: "Rugs", result: "pending", expected: 6, counted: null },
    ]);
    expect(s.discrepancies).toHaveLength(0);
    expect(s.pending).toBe(1);
  });

  it("counts a surplus too", () => {
    const s = summariseRun([{ label: "Bits", result: "fail", expected: 4, counted: 9 }]);
    // More than the register is also a finding — it usually means a receipt
    // never got entered, which matters at audit time.
    expect(s.discrepancies[0].delta).toBe(5);
    expect(s.netDelta).toBe(5);
  });
});
