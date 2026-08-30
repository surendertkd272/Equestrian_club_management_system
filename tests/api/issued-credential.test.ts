// The credential handover sheet.
//
// This feature deliberately keeps a password in a readable form, which is
// normally the wrong thing to do — so the tests are almost entirely about the
// one property that makes it defensible:
//
//   issuedPasswordEnc is non-null ONLY while the account's password is the
//   system-generated string the user has never replaced.
//
// If that ever stops holding, this stops being a delivery receipt and becomes
// a plaintext password store for passwords people chose themselves and reuse
// on their bank.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { signSession } from "@/lib/auth";
import {
  storeIssuedCredential,
  clearIssuedCredential,
  revealIssuedCredential,
} from "@/lib/issued-credential";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { GET: sheet, POST: issue } = await import("@/app/api/users/credentials/route");
const { POST: changePassword } = await import("@/app/api/account/change-password/route");

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

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

// The local .env deliberately has no PII key (encryption is provisioned per
// environment), and storeIssuedCredential fails closed without one. Give the
// suite its own key so these test the feature rather than the dormant path —
// the dormant path has its own test below, which removes it again.
const TEST_PII_KEY = "9Ip0aMPmSDb7bXKukyxYUOqXd9uLFtA0RJvVLwBk2mY=";

beforeEach(async () => {
  process.env.PII_ENCRYPTION_KEY = TEST_PII_KEY;
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Handover Club");
  centre = await mkCentre({ orgId: org.id, name: "Main Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@club.in" });
});

describe("the invariant", () => {
  it("forgets the issued password once the user picks their own", async () => {
    const coach = await mkUser({
      role: "COACH",
      centreId: centre.id,
      email: "coach@club.in",
      password: "TempPass1!",
    });
    await storeIssuedCredential(prisma, coach.id, "TempPass1!", hq.id);

    // Readable while it is still the issued temp.
    let row = await prisma.user.findUniqueOrThrow({ where: { id: coach.id } });
    expect(revealIssuedCredential(row.issuedPasswordEnc)).toBe("TempPass1!");

    // The user rotates to something they chose.
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    const res = await changePassword(
      mockReq("http://localhost/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: "TempPass1!", newPassword: "MyOwnSecret9!" }),
      }),
    );
    expect(res.status).toBe(200);

    row = await prisma.user.findUniqueOrThrow({ where: { id: coach.id } });
    // THE point of the whole feature. Their chosen password is not recoverable
    // by anyone, and the stale temp is gone rather than lingering.
    expect(row.issuedPasswordEnc).toBeNull();
    expect(revealIssuedCredential(row.issuedPasswordEnc)).toBeNull();
  });

  it("stores ciphertext, not the password", async () => {
    const u = await mkUser({ role: "GROOM", centreId: centre.id, email: "g@club.in" });
    await storeIssuedCredential(prisma, u.id, "PlainVisible1!", hq.id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    // Someone reading the table directly must not get the password.
    expect(row.issuedPasswordEnc).not.toContain("PlainVisible1!");
    expect(row.issuedPasswordEnc).toBeTruthy();
    expect(revealIssuedCredential(row.issuedPasswordEnc)).toBe("PlainVisible1!");
  });

  it("stores NOTHING rather than plaintext when no key is configured", async () => {
    // encryptPII passes plaintext through with no key — correct for Aadhaar's
    // dormant rollout, catastrophic here. Storing "shown once, unreadable
    // later" is an inconvenience; storing cleartext passwords is an incident.
    const prev = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      const u = await mkUser({ role: "GROOM", centreId: centre.id, email: "nokey@club.in" });
      await storeIssuedCredential(prisma, u.id, "WouldBePlaintext1!", hq.id);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.issuedPasswordEnc).toBeNull();
    } finally {
      process.env.PII_ENCRYPTION_KEY = prev ?? TEST_PII_KEY;
    }
  });

  it("clearIssuedCredential is idempotent", async () => {
    const u = await mkUser({ role: "GROOM", centreId: centre.id, email: "g2@club.in" });
    await clearIssuedCredential(prisma, u.id);
    await clearIssuedCredential(prisma, u.id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.issuedPasswordEnc).toBeNull();
  });
});

describe("POST /api/users/credentials — bulk issue", () => {
  const call = (body: unknown) =>
    issue(
      mockReq("http://localhost/api/users/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("issues a working password for every staff member at a centre", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "c1@club.in" });
    await mkUser({ role: "GROOM", centreId: centre.id, email: "g1@club.in" });
    await signIn(hq);

    const r = await call({ centreId: centre.id });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.issued).toHaveLength(2);

    // The handed-out password must actually authenticate, or the sheet is a
    // list of lies.
    const bcrypt = (await import("bcryptjs")).default;
    for (const row of body.issued) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: row.id } });
      expect(await bcrypt.compare(row.password, u.passwordHash)).toBe(true);
      expect(u.mustChangePassword).toBe(true);
    }
  });

  it("never mints credentials for HQ admins", async () => {
    await mkUser({ role: "ADMIN", centreId: centre.id, email: "admin@club.in" });
    await mkUser({ role: "COACH", centreId: centre.id, email: "c2@club.in" });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id })).json();
    expect(body.issued.map((i: { role: string }) => i.role)).toEqual(["COACH"]);
  });

  it("leaves already-issued users alone unless asked", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c3@club.in" });
    await storeIssuedCredential(prisma, coach.id, "AlreadyGiven1!", hq.id);
    await signIn(hq);

    // Default: skip. Re-issuing would break a password already handed over and
    // working — the "I lost the sheet" case wants a read, not a reset.
    expect((await (await call({ centreId: centre.id })).json()).issued).toHaveLength(0);
    expect((await (await call({ centreId: centre.id, includeAlreadyIssued: true })).json()).issued)
      .toHaveLength(1);
  });

  it("dryRun counts without touching a single password", async () => {
    // The guard against a label that lies: until this feature has been used
    // once, "issue for anyone without a stored credential" means EVERYONE,
    // because the column starts null on every pre-existing row. The UI counts
    // first and names the number, so nobody resets a club by accident.
    const a = await mkUser({ role: "COACH", centreId: centre.id, email: "d1@club.in" });
    await mkUser({ role: "GROOM", centreId: centre.id, email: "d2@club.in" });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id, dryRun: true })).json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldAffect).toBe(2);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.issuedPasswordEnc).toBeNull();
    expect(after.tokenVersion).toBe(before.tokenVersion);
  });

  it("cannot reach into another club, even with an explicit id", async () => {
    const other = await mkOrg("Rival Club");
    const otherCentre = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await mkUser({ role: "COACH", centreId: otherCentre.id, email: "v@rival.in" });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    await signIn(hq);

    const body = await (await call({ centreId: centre.id, userIds: [victim.id] })).json();
    expect(body.issued).toHaveLength(0);
    // Their password is untouched — no silent cross-tenant reset.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.issuedPasswordEnc).toBeNull();
  });

  it("refuses a non-HQ caller", async () => {
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@club.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await call({ centreId: centre.id })).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    cookieJar.clear();
    expect((await call({ centreId: centre.id })).status).toBe(401);
  });
});

describe("GET /api/users/credentials — re-open the sheet", () => {
  const read = (centreId: string) =>
    sheet(mockReq(`http://localhost/api/users/credentials?centreId=${centreId}`));

  it("re-reads the same passwords without resetting anything", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "c4@club.in" });
    await signIn(hq);
    const issued = (await (await issue(
      mockReq("http://localhost/api/users/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centreId: centre.id }),
      }),
    )).json()).issued;

    const body = await (await read(centre.id)).json();
    // This is the whole point: the lost printout is recoverable.
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].password).toBe(issued[0].password);
  });

  it("shows nothing for a user who has set their own password", async () => {
    const coach = await mkUser({
      role: "COACH",
      centreId: centre.id,
      email: "c5@club.in",
      password: "TempPass1!",
    });
    await storeIssuedCredential(prisma, coach.id, "TempPass1!", hq.id);
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    await changePassword(
      mockReq("http://localhost/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: "TempPass1!", newPassword: "MyOwnSecret9!" }),
      }),
    );

    await signIn(hq);
    const body = await (await read(centre.id)).json();
    expect(body.rows).toHaveLength(0);
  });

  it("records who read the sheet", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "c6@club.in" });
    await signIn(hq);
    await read(centre.id);
    const log = await prisma.auditLog.findFirst({
      where: { action: "user.credentials_revealed" },
    });
    // Reading a batch of live credentials must not be an untraceable act.
    expect(log).not.toBeNull();
    expect(log?.userId).toBe(hq.id);
  });

  it("refuses a non-HQ caller", async () => {
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m2@club.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await read(centre.id)).status).toBe(403);
  });
});
