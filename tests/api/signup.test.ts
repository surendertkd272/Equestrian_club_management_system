// Public self-serve club registration.
//
// This mints an Organisation and a SUPER_ADMIN from an unauthenticated
// request, so the tests are mostly about what it refuses: enumeration,
// weak passwords, and signing anyone in before they've proved the address.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { slugify, uniqueSlug } from "@/lib/slugify";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: signup } = await import("@/app/api/auth/signup/route");

const call = (body: unknown) =>
  signup(
    mockReq("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const GOOD = {
  clubName: "Silverline Riding Club",
  adminName: "Asha Rao",
  email: "asha@silverline.in",
  password: "GoodPass1!",
};

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("slug derivation", () => {
  it("builds a valid slug from a club name", () => {
    expect(slugify("Silverline Riding Club")).toBe("silverline-riding-club");
    expect(slugify("  Hooves & Hearts!  ")).toBe("hooves-hearts");
  });

  it("keeps slugs starting with a letter", () => {
    // The schema demands /^[a-z].../ — a name starting with a digit would
    // otherwise produce something that fails validation with nothing the
    // person signing up could do about it.
    expect(slugify("4 Hooves")).toMatch(/^[a-z]/);
  });

  it("disambiguates within the length cap instead of colliding", async () => {
    const taken = new Set(["riders", "riders-2"]);
    expect(await uniqueSlug("Riders", async (s) => taken.has(s))).toBe("riders-3");
  });
});

describe("POST /api/auth/signup", () => {
  it("creates org + centre + super admin, on a trial", async () => {
    const r = await call(GOOD);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, pendingVerification: true });

    const org = await prisma.organisation.findFirstOrThrow({ where: { name: GOOD.clubName } });
    expect(org.status).toBe("trial");
    expect(org.trialEndsAt).not.toBeNull();
    expect(org.slug).toBe("silverline-riding-club");

    const centre = await prisma.centre.findFirstOrThrow({ where: { orgId: org.id } });
    expect(centre.name).toBe(GOOD.clubName);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: GOOD.email } });
    expect(admin.role).toBe("SUPER_ADMIN");
    expect(admin.orgId).toBe(org.id);
    // They chose the password, so there is nothing to force-rotate.
    expect(admin.mustChangePassword).toBe(false);
    // ...and nothing is usable until the address is proved.
    expect(admin.emailVerifiedAt).toBeNull();
  });

  it("does not sign anyone in — verification is the gate", async () => {
    await call(GOOD);
    expect(cookieJar.size).toBe(0);
  });

  it("answers identically for an address already registered", async () => {
    await mkUser({ email: "taken@club.in", password: "x" });
    const r = await call({ ...GOOD, email: "taken@club.in" });
    // Same body and status as a fresh signup: this endpoint must not be usable
    // to discover who is already a customer.
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, pendingVerification: true });
    // ...and nothing was created for them.
    expect(await prisma.organisation.count({ where: { name: GOOD.clubName } })).toBe(0);
  });

  it("gives a second club with the same name a distinct slug", async () => {
    await call(GOOD);
    await call({ ...GOOD, email: "other@silverline.in" });
    const orgs = await prisma.organisation.findMany({ where: { name: GOOD.clubName } });
    expect(orgs).toHaveLength(2);
    expect(new Set(orgs.map((o) => o.slug)).size).toBe(2);
  });

  it("rejects a weak password before creating anything", async () => {
    const r = await call({ ...GOOD, password: "password" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "WEAK_PASSWORD" });
    expect(await prisma.organisation.count()).toBe(0);
  });

  it("requires a solved CAPTCHA in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = await call(GOOD);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "CAPTCHA_FAILED" });
    expect(await prisma.organisation.count()).toBe(0);
  });

  it("validates the payload", async () => {
    expect((await call({ ...GOOD, email: "not-an-email" })).status).toBe(400);
    expect((await call({ ...GOOD, clubName: "" })).status).toBe(400);
  });
});

describe("owner notification", () => {
  it("escapes user-supplied names before they reach the email body", async () => {
    const { esc } = await import("@/lib/notify-owner");
    // A club name is unauthenticated input; unescaped it would render as a
    // live link in a message that looks system-generated.
    expect(esc('<a href="evil">Click here</a>')).toBe(
      "&lt;a href=&quot;evil&quot;&gt;Click here&lt;/a&gt;",
    );
    expect(esc("Ranjit & Sons")).toBe("Ranjit &amp; Sons");
    expect(esc(null)).toBe("");
  });

  it("falls back to OPS_ALERT_EMAIL when no dedicated address is set", async () => {
    const { ownerNotifyAddress } = await import("@/lib/notify-owner");
    vi.stubEnv("OWNER_NOTIFY_EMAIL", "");
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@club.in");
    expect(ownerNotifyAddress()).toBe("ops@club.in");
    vi.stubEnv("OWNER_NOTIFY_EMAIL", "owner@club.in");
    expect(ownerNotifyAddress()).toBe("owner@club.in");
  });

  it("a signup still succeeds when no notify address is configured", async () => {
    vi.stubEnv("OWNER_NOTIFY_EMAIL", "");
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    const r = await call({ ...GOOD, email: "nonotify@club.in" });
    expect(r.status).toBe(200);
    expect(await prisma.organisation.count({ where: { name: GOOD.clubName } })).toBe(1);
  });
});
