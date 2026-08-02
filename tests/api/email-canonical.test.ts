// C1 from docs/LOGIN_AUTH_AUDIT.md — login emails are canonicalised.
//
// User.email is matched exactly by the sign-in paths and Postgres @unique is
// case-sensitive, so a row stored with capitals could not sign in with the
// address its owner types, could never use the email-code path (which
// lowercased first and found nobody), and did not block a second account at the
// same address in different case.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/email-normalize";
import { createUserSchema } from "@/lib/schemas/user-admin";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string; opts?: unknown }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: unknown) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: otpRequest } = await import("@/app/api/auth/otp/request/route");
const { POST: forgot } = await import("@/app/api/auth/forgot-password/route");

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

describe("normalizeEmail", () => {
  it("folds case and trims, and leaves the local part otherwise intact", () => {
    expect(normalizeEmail("  Rahul@Club.IN ")).toBe("rahul@club.in");
    // Not a duplicate of rahul@club.in — plus-tags are the user's own namespace.
    expect(normalizeEmail("Rahul+Barn@Club.in")).toBe("rahul+barn@club.in");
    expect(normalizeEmail("a.b@c.in")).toBe("a.b@c.in");
  });

  it("canonicalises at the schema boundary, so callers can't forget", () => {
    const parsed = createUserSchema.parse({
      name: "Rahul S",
      email: "Rahul@Club.IN",
      role: "COACH",
    });
    expect(parsed.email).toBe("rahul@club.in");
  });

  // Addresses pasted out of a mail client routinely carry a trailing space.
  // Validating before trimming rejected those as "Invalid email".
  it("accepts a pasted address with surrounding whitespace", () => {
    const parsed = createUserSchema.parse({
      name: "Rahul S",
      email: "  Rahul@Club.IN ",
      role: "COACH",
    });
    expect(parsed.email).toBe("rahul@club.in");
  });
});

describe("sign-in is case-insensitive on the address", () => {
  it("signs in when the user types their own address in a different case", async () => {
    await mkUser({ email: "rahul@club.in", password: "GoodPass1!", role: "COACH" });

    const r = await post(login, "/api/auth/login", {
      email: "Rahul@Club.IN",
      password: "GoodPass1!",
    });
    expect(r.status).toBe(200);
    expect(cookieJar.get("ew_session")).toBeDefined();
  });

  it("finds the account for an email sign-in code regardless of typed case", async () => {
    const user = await mkUser({ email: "otpcase@club.in", password: "GoodPass1!", role: "COACH" });

    const r = await post(otpRequest, "/api/auth/otp/request", { email: "OtpCase@Club.IN" });
    expect(r.status).toBe(200);

    // Silent-200 endpoint, so the proof it actually matched is the issued code.
    const token = await prisma.emailVerifyToken.findFirst({ where: { userId: user.id } });
    expect(token).not.toBeNull();
  });

  it("finds the account for a password reset regardless of typed case", async () => {
    const user = await mkUser({ email: "reset@club.in", password: "GoodPass1!", role: "COACH" });

    const r = await post(forgot, "/api/auth/forgot-password", { email: "RESET@CLUB.IN" });
    expect(r.status).toBe(200);

    const token = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(token).not.toBeNull();
  });
});
