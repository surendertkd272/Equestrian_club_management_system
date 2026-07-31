// Regression cover for the three sign-in journey breaks found in the July 2026
// login audit (docs/LOGIN_AUTH_AUDIT.md):
//
//   A1  changing your password invalidated the cookie in front of you, so the
//       forced-rotation flow dumped every new staff member back on /login
//   A2  a 2FA-enrolled user could not complete a password sign-in
//   A3  a user inside the DPDPA deletion grace window could authenticate but
//       never hold a session, and had no way to withdraw the request

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { verifySession, signSession } from "@/lib/auth";
import { generateTotp, generateTotpSecret } from "@/lib/totp";
import { issueEmailVerifyCode } from "@/lib/email-verify";
import { humanizeError } from "@/lib/error-messages";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string; opts?: unknown }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: unknown) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

// Late imports so the next/headers mock is registered before lib/auth loads it.
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: otpVerify } = await import("@/app/api/auth/otp/verify/route");
const { POST: cancelDeletion } = await import("@/app/api/auth/cancel-deletion/route");
const { POST: changePassword } = await import("@/app/api/account/change-password/route");

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

// ── A1 ───────────────────────────────────────────────────────────────────────

describe("POST /api/account/change-password — keeps the caller signed in", () => {
  it("re-issues the session cookie with the bumped tokenVersion", async () => {
    const user = await mkUser({
      email: "rotate@test.local",
      password: "TempPass1!",
      role: "COACH",
      name: "R. Otate",
    });
    cookieJar.set("ew_session", {
      value: await signSession({
        userId: user.id,
        role: "COACH",
        centreId: null,
        name: "R. Otate",
        tokenVersion: user.tokenVersion,
      }),
    });
    const before = cookieJar.get("ew_session")!.value;

    const r = await post(changePassword, "/api/account/change-password", {
      currentPassword: "TempPass1!",
      newPassword: "BrandNew9$pass",
    });
    expect(r.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.tokenVersion).toBe(user.tokenVersion + 1);
    expect(row.mustChangePassword).toBe(false);

    // The regression: the cookie must have been replaced, and its tokenVersion
    // must match the row — otherwise getSession() nulls the session on the very
    // next request and the user is bounced to /login?ended=1.
    const after = cookieJar.get("ew_session")!.value;
    expect(after).not.toBe(before);
    const session = await verifySession(after);
    expect(session).not.toBeNull();
    expect(session!.tokenVersion).toBe(row.tokenVersion);
    expect(session!.userId).toBe(user.id);
  });

  it("carries impersonation markers across the rotation", async () => {
    const user = await mkUser({ email: "imp@test.local", password: "TempPass1!", role: "COACH" });
    const expiresAt = Date.now() + 30 * 60_000;
    cookieJar.set("ew_session", {
      value: await signSession({
        userId: user.id,
        role: "COACH",
        centreId: null,
        name: "Test User",
        tokenVersion: user.tokenVersion,
        impersonatedBy: "owner-123",
        impersonationExpiresAt: expiresAt,
      }),
    });

    const r = await post(changePassword, "/api/account/change-password", {
      currentPassword: "TempPass1!",
      newPassword: "BrandNew9$pass",
    });
    expect(r.status).toBe(200);

    const session = await verifySession(cookieJar.get("ew_session")!.value);
    expect(session!.impersonatedBy).toBe("owner-123");
    expect(session!.impersonationExpiresAt).toBe(expiresAt);
  });
});

// ── A2 ───────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — second factor", () => {
  async function mk2faUser(email: string) {
    const secret = generateTotpSecret();
    const user = await mkUser({ email, password: "GoodPass1!", role: "COACH" });
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactor: true, totpSecret: secret },
    });
    return { user, secret };
  }

  it("challenges with TWO_FACTOR_REQUIRED and mints no cookie", async () => {
    await mk2faUser("tfa@test.local");
    const r = await post(login, "/api/auth/login", { email: "tfa@test.local", password: "GoodPass1!" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "TWO_FACTOR_REQUIRED" });
    expect(cookieJar.size).toBe(0);
  });

  it("rejects a wrong authenticator code with TWO_FACTOR_INVALID", async () => {
    const { secret } = await mk2faUser("tfa2@test.local");
    // Any 6-digit string that isn't the live code.
    const live = generateTotp(secret);
    const wrong = live === "000000" ? "111111" : "000000";
    const r = await post(login, "/api/auth/login", {
      email: "tfa2@test.local",
      password: "GoodPass1!",
      totpCode: wrong,
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "TWO_FACTOR_INVALID" });
    expect(cookieJar.size).toBe(0);
  });

  it("signs in when the authenticator code is correct", async () => {
    const { user, secret } = await mk2faUser("tfa3@test.local");
    const r = await post(login, "/api/auth/login", {
      email: "tfa3@test.local",
      password: "GoodPass1!",
      totpCode: generateTotp(secret),
    });
    expect(r.status).toBe(200);
    const session = await verifySession(cookieJar.get("ew_session")!.value);
    expect(session!.userId).toBe(user.id);
  });

  // The login form reads these codes off the response to decide what to render;
  // an unmapped code showed the user "Something went wrong. Please try again."
  it("maps both tenant 2FA codes to human copy", () => {
    const generic = "Something went wrong. Please try again.";
    expect(humanizeError({ error: "TWO_FACTOR_REQUIRED" })).not.toBe(generic);
    expect(humanizeError({ error: "TWO_FACTOR_INVALID" })).not.toBe(generic);
  });
});

// ── A3 ───────────────────────────────────────────────────────────────────────

describe("deletion grace window", () => {
  async function mkPendingUser(email: string, requestedAt = new Date()) {
    const user = await mkUser({ email, password: "GoodPass1!", role: "COACH" });
    return prisma.user.update({
      where: { id: user.id },
      data: { deletionRequestedAt: requestedAt, tokenVersion: { increment: 1 } },
    });
  }

  it("refuses the password sign-in with DELETION_PENDING + the erase date", async () => {
    const requestedAt = new Date("2026-07-01T00:00:00.000Z");
    await mkPendingUser("del@test.local", requestedAt);

    const r = await post(login, "/api/auth/login", { email: "del@test.local", password: "GoodPass1!" });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("DELETION_PENDING");
    // 30-day grace, matching lib/sweeps/dpdpa-deletions.ts.
    expect(body.scheduledFor).toBe(new Date("2026-07-31T00:00:00.000Z").toISOString());
    // The loop this fixes: a cookie here meant sign-in "worked", then every
    // layout bounced to /login?ended=1 because getSession() nulls the session.
    expect(cookieJar.size).toBe(0);
  });

  it("refuses the OTP sign-in WITHOUT burning the emailed code", async () => {
    const user = await mkPendingUser("delotp@test.local");
    const code = await issueEmailVerifyCode(user.id, user.email);

    const r = await post(otpVerify, "/api/auth/otp/verify", { email: user.email, code });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "DELETION_PENDING" });
    expect(cookieJar.size).toBe(0);

    // The code has to survive — it's the credential the user needs to authorise
    // the cancel they're about to be offered.
    const token = await prisma.emailVerifyToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(token.usedAt).toBeNull();
  });

  it("cancel-deletion clears the flag with a password and lets the user back in", async () => {
    const user = await mkPendingUser("delcancel@test.local");

    const c = await post(cancelDeletion, "/api/auth/cancel-deletion", {
      email: "delcancel@test.local",
      password: "GoodPass1!",
    });
    expect(c.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).toBeNull();
    expect(row.tokenVersion).toBe(user.tokenVersion + 1);

    const r = await post(login, "/api/auth/login", {
      email: "delcancel@test.local",
      password: "GoodPass1!",
    });
    expect(r.status).toBe(200);
    expect(cookieJar.get("ew_session")).toBeDefined();
  });

  it("cancel-deletion accepts the emailed sign-in code, for users with no password to hand", async () => {
    const user = await mkPendingUser("delcode@test.local");
    const code = await issueEmailVerifyCode(user.id, user.email);

    const c = await post(cancelDeletion, "/api/auth/cancel-deletion", { email: user.email, code });
    expect(c.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).toBeNull();
    // Single-use: the code is spent now that it has actually authorised something.
    const token = await prisma.emailVerifyToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(token.usedAt).not.toBeNull();
  });

  it("cancel-deletion rejects a wrong password and leaves the flag set", async () => {
    const user = await mkPendingUser("delwrong@test.local");
    const c = await post(cancelDeletion, "/api/auth/cancel-deletion", {
      email: "delwrong@test.local",
      password: "not-the-password",
    });
    expect(c.status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).not.toBeNull();
  });

  it("cancel-deletion 409s when nothing is pending", async () => {
    await mkUser({ email: "notpending@test.local", password: "GoodPass1!", role: "COACH" });
    const c = await post(cancelDeletion, "/api/auth/cancel-deletion", {
      email: "notpending@test.local",
      password: "GoodPass1!",
    });
    expect(c.status).toBe(409);
    expect(await c.json()).toMatchObject({ error: "NOT_PENDING" });
  });

  it("cancel-deletion needs a credential, not just an email", async () => {
    await mkPendingUser("delbare@test.local");
    const c = await post(cancelDeletion, "/api/auth/cancel-deletion", { email: "delbare@test.local" });
    expect(c.status).toBe(400);
  });
});
