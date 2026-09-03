// Raising a due by hand.
//
// Dues previously only appeared from enrolment approval and event entry —
// there was no create-invoice endpoint anywhere — so a club tracking dues
// internally could record what the system happened to generate and nothing
// else. No monthly coaching fee, no one-off charge.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { signSession } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: createInvoice } = await import("@/app/api/invoices/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;
let rider: Awaited<ReturnType<typeof mkRider>>;

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id, role: u.role as never, centreId: u.centreId,
      orgId: u.orgId ?? null, tokenVersion: 0, name: "T",
    } as never),
  });
}

const call = (body: unknown) =>
  createInvoice(mockReq("http://localhost/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

const DUE = { amount: 5000, kind: "monthly", dueDate: new Date(Date.now() + 7 * 86400_000).toISOString() };

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Dues Club");
  centre = await mkCentre({ orgId: org.id, name: "Dues Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@d.in" });
  rider = await mkRider({ centreId: centre.id });
});

describe("raising a due", () => {
  it("records any amount against a rider", async () => {
    await signIn(hq);
    const res = await call({ riderId: rider.id, ...DUE, amount: 250000 });
    expect(res.status).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow();
    expect(inv.amount).toBe(250000);
    expect(inv.status).toBe("due");
    expect(inv.centreId).toBe(centre.id);
  });

  it("takes the centre from the RIDER, not the caller", async () => {
    await signIn(hq);
    await call({ riderId: rider.id, ...DUE, centreId: "somewhere-else" });
    expect((await prisma.invoice.findFirstOrThrow()).centreId).toBe(centre.id);
  });

  it("refuses a rider in another tenant", async () => {
    const other = await mkOrg("Rival Dues");
    const oc = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await mkRider({ centreId: oc.id });
    await signIn(hq);
    expect((await call({ riderId: victim.id, ...DUE })).status).toBe(404);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("pins a centre manager to their own riders", async () => {
    const other = await mkCentre({ orgId: org.id, name: "Other Centre" });
    const elsewhere = await mkRider({ centreId: other.id });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@d.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await call({ riderId: elsewhere.id, ...DUE })).status).toBe(404);
  });

  it("refuses when the club does not track dues", async () => {
    await prisma.orgFeature.updateMany({
      where: { orgId: org.id, featureKey: { in: ["dues-tracking", "fee-collection"] } },
      data: { enabled: false },
    });
    await signIn(hq);
    expect((await call({ riderId: rider.id, ...DUE })).status).toBe(403);
  });

  it("works with dues tracked internally and billing OFF", async () => {
    // The mode this exists for.
    await prisma.orgFeature.updateMany({
      where: { orgId: org.id, featureKey: "fee-collection" }, data: { enabled: false },
    });
    await prisma.orgFeature.updateMany({
      where: { orgId: org.id, featureKey: "dues-tracking" }, data: { enabled: true },
    });
    await signIn(hq);
    expect((await call({ riderId: rider.id, ...DUE })).status).toBe(200);
  });

  it("rejects a zero amount and a bad date", async () => {
    await signIn(hq);
    expect((await call({ riderId: rider.id, ...DUE, amount: 0 })).status).toBe(400);
    expect((await call({ riderId: rider.id, ...DUE, dueDate: "not-a-date" })).status).toBe(400);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("refuses a coach", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@d.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await call({ riderId: rider.id, ...DUE })).status).toBe(403);
  });
});
