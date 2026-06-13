import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { mockReq } from "../helpers/request";

// Locks the C1 cross-tenant isolation work: a user must never see another
// org's (or another centre's) data through a scoped endpoint. Uses /api/search
// as the probe — it sweeps riders/horses/etc. and is scoped via
// tenantWhere(centreId, orgId). (App-code layer; the DB-level RLS backstop is
// separate and can't run under the db-push test harness.)

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { GET: search } = await import("@/app/api/search/route");

async function login(p: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(p) });
}
const hits = async (q: string) =>
  (await (await search(mockReq(`http://localhost/api/search?q=${q}`))).json()).hits as unknown[];

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("cross-tenant isolation (C1)", () => {
  it("an HQ admin cannot find another ORG's rider via search", async () => {
    const orgA = await mkOrg("Org A");
    const orgB = await mkOrg("Org B");
    const centreA = await mkCentre({ orgId: orgA.id });
    const centreB = await mkCentre({ orgId: orgB.id });
    await mkRider({ centreId: centreA.id, firstName: "Alpharider", lastName: "Mine" });
    await mkRider({ centreId: centreB.id, firstName: "Betarider", lastName: "Theirs" });

    // HQ admin of org A: no centreId, orgId set → resolves to orgA.
    const admin = await prisma.user.create({
      data: { email: "admin-a@test.local", passwordHash: "x", name: "Admin A", role: "ADMIN", orgId: orgA.id },
    });
    await login({ userId: admin.id, role: "ADMIN", centreId: null, name: admin.name });

    expect((await hits("Alpharider")).length).toBeGreaterThan(0); // own org visible
    expect((await hits("Betarider")).length).toBe(0); // other org invisible
  });

  it("a centre manager cannot find a rider from another CENTRE in the same org", async () => {
    const org = await mkOrg();
    const centreA = await mkCentre({ orgId: org.id });
    const centreB = await mkCentre({ orgId: org.id });
    await mkRider({ centreId: centreA.id, firstName: "Homerider" });
    await mkRider({ centreId: centreB.id, firstName: "Gammarider" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centreA.id });
    await login({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centreA.id, name: mgr.name });

    expect((await hits("Homerider")).length).toBeGreaterThan(0); // own centre
    expect((await hits("Gammarider")).length).toBe(0); // sibling centre, same org
  });
});
