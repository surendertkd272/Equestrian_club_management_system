// Portal logins for a whole centre at once.
//
// Zero riders in a hundred had a login, and creating them one at a time —
// typing an address per rider — is why. The interesting behaviour is the
// address resolution: two thirds of these riders are children with no email
// of their own, so a feature that only reads rider.email would have created
// almost nothing and looked broken.

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
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: bulk } = await import("@/app/api/riders/portal-access/bulk/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

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
  bulk(mockReq("http://localhost/api/riders/portal-access/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  process.env.PII_ENCRYPTION_KEY = "9Ip0aMPmSDb7bXKukyxYUOqXd9uLFtA0RJvVLwBk2mY=";
  org = await mkOrg("Portal Club");
  centre = await mkCentre({ orgId: org.id, name: "Portal Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@p.in" });
});

describe("bulk portal access", () => {
  it("creates a working login from the rider's own email", async () => {
    const r = await mkRider({ centreId: centre.id, email: "rider@p.in" });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.created).toHaveLength(1);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.userId).not.toBeNull();

    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: after.userId! } });
    // The handed-over password must actually authenticate, or the list is
    // a list of lies.
    expect(await bcrypt.compare(body.created[0].password, user.passwordHash)).toBe(true);
    expect(user.role).toBe("RIDER");
    expect(user.mustChangePassword).toBe(true);
  });

  it("leaves the parent's email for the parent login", async () => {
    // A child with no address of their own, whose parent gave one at
    // registration. That address used to become the CHILD's login — and the
    // parent login that needed it was then refused as "email taken". It now
    // stays free for /api/riders/parent-access/bulk.
    const r = await mkRider({ centreId: centre.id, email: null });
    await prisma.rider.update({
      where: { id: r.id },
      data: { parentalConsentJson: { parentEmail: "mum@p.in", parentName: "Priya" } },
    });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.created).toHaveLength(0);
    expect(body.noEmail).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: "mum@p.in" } })).toBe(0);
  });

  it("won't key a student login on an address that is a parent's", async () => {
    const r = await mkRider({ centreId: centre.id, email: "Family@P.in" });
    await prisma.rider.update({
      where: { id: r.id },
      data: { parentalConsentJson: { parentEmail: "family@p.in", parentName: "Priya" } },
    });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.created).toHaveLength(0);
    expect(body.familyEmail).toHaveLength(1);
  });

  it("never invents an address — reports the rider by name instead", async () => {
    await mkRider({ centreId: centre.id, email: null, firstName: "Unreachable" });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.created).toHaveLength(0);
    // A login keyed on a made-up email is worse than no login.
    expect(body.noEmail[0].name).toContain("Unreachable");
  });

  it("reports a shared family address instead of aborting the batch", async () => {
    // Siblings on one parent email is completely normal, and User.email is
    // globally unique — so this is an expected outcome, not an error.
    await mkRider({ centreId: centre.id, email: "family@p.in", firstName: "First" });
    await mkRider({ centreId: centre.id, email: "family@p.in", firstName: "Second" });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.created).toHaveLength(1);
    expect(body.emailTaken).toHaveLength(1);
  });

  it("skips riders who already have a login", async () => {
    const r = await mkRider({ centreId: centre.id, email: "has@p.in" });
    await signIn(hq);
    await call({ centreId: centre.id });
    const second = await (await call({ centreId: centre.id })).json();
    expect(second.created).toHaveLength(0);
    void r;
  });

  it("dryRun counts without creating anything", async () => {
    await mkRider({ centreId: centre.id, email: "dry@p.in" });
    await signIn(hq);
    const body = await (await call({ centreId: centre.id, dryRun: true })).json();
    expect(body.wouldCreate).toBe(1);
    expect(await prisma.user.count({ where: { role: "RIDER" } })).toBe(0);
  });

  it("cannot reach another club's riders", async () => {
    const other = await mkOrg("Rival Portal");
    const oc = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await mkRider({ centreId: oc.id, email: "v@rival.in" });
    await signIn(hq);

    await call({ centreId: centre.id, riderIds: [victim.id] });
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.userId).toBeNull();
  });

  it("refuses a coach", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@p.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await call({ centreId: centre.id })).status).toBe(403);
  });
});
