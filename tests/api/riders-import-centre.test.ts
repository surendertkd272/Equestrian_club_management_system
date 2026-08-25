// Centre resolution on the rider bulk import.
//
// Import is centre-wise, and the centre is NOT in the file — it comes from who
// you are and which centre is selected. Two things had gone wrong there: an HQ
// SUPER_ADMIN (session.centreId = null) could not import at all, and a
// hand-crafted ?centreId= was accepted with no organisation check, which is a
// cross-tenant write.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: importRiders } = await import("@/app/api/riders/import/route");

const CSV = [
  "first_name,last_name,mobile,dob",
  "Aarav,Sharma,9876543210,2014-08-23",
].join("\n");

async function signIn(userId: string, role: Role, centreId: string | null, hqPick?: string) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "T", tokenVersion: 0 }),
  });
  // The top-bar centre picker persists as a cookie; that is how an HQ user
  // chooses a destination.
  if (hqPick) cookieJar.set("ew_hq_centre", { value: hqPick });
}

const call = (query = "") =>
  importRiders(
    mockReq(`http://localhost/api/riders/import${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: CSV, dryRun: true }),
    }),
  );

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("rider import — which centre do rows land in?", () => {
  it("a centre manager imports into their own centre", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ dryRun: true, wouldCreate: 1 });
  });

  it("an HQ super admin can import once a centre is picked", async () => {
    const org = await mkOrg("HQ Org");
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    // This is the case that used to fail outright: session.centreId is null,
    // and the old code resolved that to "" and returned NO_CENTRE_CONTEXT.
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ wouldCreate: 1 });
  });

  it("tells an HQ user on 'All centres' to pick one, rather than failing obscurely", async () => {
    const org = await mkOrg("HQ Org");
    await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null); // no picker cookie
    const r = await call();
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("NO_CENTRE_SELECTED");
    expect(body.message).toMatch(/centre selector/i);
  });

  it("refuses a centre belonging to another organisation", async () => {
    const mine = await mkOrg("Mine");
    const theirs = await mkOrg("Theirs");
    await mkCentre({ orgId: mine.id });
    const foreign = await mkCentre({ orgId: theirs.id, name: "Their Centre" });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: mine.id });
    // A hand-crafted query param aimed at another tenant's centre.
    await signIn(admin.id, "SUPER_ADMIN", null);
    const r = await call(`?centreId=${foreign.id}`);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "FORBIDDEN_CROSS_ORG" });
    expect(await prisma.rider.count({ where: { centreId: foreign.id } })).toBe(0);
  });
});
