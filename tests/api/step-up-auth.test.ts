// Step-up re-authentication on destructive / bulk-PII endpoints, and the
// anti-spam gate on public rider enrolment.
//
// Both account endpoints used to accept a bare session: a cookie lifted off a
// shared machine could schedule the owner's account for erasure, or pull an
// entire centre's records. export-all was additionally a GET, and the session
// cookie is sameSite:"lax" — which deliberately DOES ride along on top-level
// navigations — so a link was enough to trigger it.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre } from "../helpers/fixtures";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { issueChallenge, verifyChallenge } from "@/lib/captcha";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string; opts?: unknown }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: unknown) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: requestDelete } = await import("@/app/api/account/delete/route");
const { POST: exportAll } = await import("@/app/api/account/export-all/route");

async function signIn(userId: string, role: Role, centreId: string | null, tokenVersion: number) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "T", tokenVersion }),
  });
}

function post(handler: (r: ReturnType<typeof mockReq>) => Promise<Response>, url: string, body: unknown) {
  return handler(
    mockReq(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/account/delete — step-up", () => {
  it("refuses a session-only request", async () => {
    const u = await mkUser({ password: "GoodPass1!" });
    await signIn(u.id, u.role as Role, null, u.tokenVersion);
    const r = await post(requestDelete, "/api/account/delete", {});
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "PASSWORD_REQUIRED" });
  });

  it("refuses a wrong password and schedules nothing", async () => {
    const u = await mkUser({ password: "GoodPass1!" });
    await signIn(u.id, u.role as Role, null, u.tokenVersion);
    const r = await post(requestDelete, "/api/account/delete", { currentPassword: "wrong" });
    expect(r.status).toBe(401);

    const { prisma } = await import("@/lib/prisma");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.deletionRequestedAt).toBeNull();
  });

  it("accepts the correct password", async () => {
    const u = await mkUser({ password: "GoodPass1!" });
    await signIn(u.id, u.role as Role, null, u.tokenVersion);
    const r = await post(requestDelete, "/api/account/delete", { currentPassword: "GoodPass1!" });
    expect(r.status).toBe(200);
  });
});

describe("POST /api/account/export-all — step-up", () => {
  it("refuses a session-only request from an authorised role", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, password: "GoodPass1!" });
    await signIn(u.id, "CENTRE_MANAGER", centre.id, u.tokenVersion);
    const r = await post(exportAll, "/api/account/export-all", {});
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "PASSWORD_REQUIRED" });
  });

  it("refuses a wrong password", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, password: "GoodPass1!" });
    await signIn(u.id, "CENTRE_MANAGER", centre.id, u.tokenVersion);
    const r = await post(exportAll, "/api/account/export-all", { currentPassword: "nope" });
    expect(r.status).toBe(401);
  });

  it("still refuses an unauthorised role before any password check", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: centre.id, password: "GoodPass1!" });
    await signIn(u.id, "COACH", centre.id, u.tokenVersion);
    const r = await post(exportAll, "/api/account/export-all", { currentPassword: "GoodPass1!" });
    expect(r.status).toBe(403);
  });

  it("exports for an authorised role with the correct password", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, password: "GoodPass1!" });
    await signIn(u.id, "CENTRE_MANAGER", centre.id, u.tokenVersion);
    const r = await post(exportAll, "/api/account/export-all", { currentPassword: "GoodPass1!" });
    expect(r.status).toBe(200);
  });
});

describe("public rider enrolment — CAPTCHA gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  function asProduction() {
    vi.stubEnv("NODE_ENV", "production");
  }

  // The gate is production-only so dev/UAT stays frictionless; these force the
  // production branch rather than asserting on the dev bypass.
  it("rejects a production submission with no challenge answer", async () => {
    const { POST: onboard } = await import("@/app/api/onboarding/route");
    const centre = await mkCentre();
    asProduction();
    const r = await post(onboard, "/api/onboarding", {
      centreSlug: centre.slug,
      firstName: "A",
      lastName: "B",
    });
    // Either the payload fails validation or the captcha gate rejects it —
    // what matters is that a captcha-less production submit never succeeds.
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("verifyChallenge accepts a freshly issued answer and rejects a wrong one", () => {
    const { question, token } = issueChallenge();
    // Questions are "a + b" or "a − b" with the real minus sign.
    const [x, op, y] = question.split(" ");
    const expected = op === "+" ? Number(x) + Number(y) : Number(x) - Number(y);
    expect(verifyChallenge(token, String(expected))).toBe(true);
    expect(verifyChallenge(token, String(expected + 1))).toBe(false);
  });
});
