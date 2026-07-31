// B1 from docs/LOGIN_AUTH_AUDIT.md — brute-force protection that survives
// serverless.
//
// The limiter used to be a Map in process memory: on Vercel each lambda kept
// its own copy and cold starts reset it, so the real cap was
// (limit x live instances). And the tenant login's account cap was keyed on
// `${ip}:${email}`, so stuffing spread across IPs got a fresh allowance per IP
// and the account axis caught nothing.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { checkRate, peekRate, recordFailure, clearRate, clientFingerprint } from "@/lib/rate-limit";
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

// Each request carries its own forwarded-for so a test can simulate an
// attacker rotating source addresses.
function postLogin(body: unknown, ip = "203.0.113.9") {
  return login(
    mockReq("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("durable counters", () => {
  it("persists in the database, not process memory", async () => {
    await checkRate("t:persist", 5, 60_000);
    await checkRate("t:persist", 5, 60_000);
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: "t:persist" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it("blocks once the limit is exceeded and reports a retry-after", async () => {
    for (let i = 0; i < 3; i++) expect((await checkRate("t:block", 3, 60_000)).ok).toBe(true);
    const blocked = await checkRate("t:block", 3, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it("counts concurrent callers without losing any to a read-modify-write race", async () => {
    // The whole point of the single atomic INSERT .. ON CONFLICT statement:
    // ten lambdas hitting the same key at once must produce a count of ten.
    await Promise.all(Array.from({ length: 10 }, () => checkRate("t:race", 100, 60_000)));
    const row = await prisma.rateLimitCounter.findFirst({ where: { key: "t:race" } });
    expect(row?.count).toBe(10);
  });

  it("peekRate reads without consuming; recordFailure consumes", async () => {
    expect((await peekRate("t:peek", 1, 60_000)).ok).toBe(true);
    expect((await peekRate("t:peek", 1, 60_000)).ok).toBe(true);
    expect(await prisma.rateLimitCounter.findFirst({ where: { key: "t:peek" } })).toBeNull();

    await recordFailure("t:peek", 60_000);
    expect((await peekRate("t:peek", 1, 60_000)).ok).toBe(false);
  });

  it("clearRate forgives a key", async () => {
    await recordFailure("t:clear", 60_000);
    await recordFailure("t:clear", 60_000);
    expect((await peekRate("t:clear", 2, 60_000)).ok).toBe(false);
    await clearRate("t:clear");
    expect((await peekRate("t:clear", 2, 60_000)).ok).toBe(true);
  });
});

describe("clientFingerprint", () => {
  it("prefers platform-set headers over the client-supplied x-forwarded-for", () => {
    const req = mockReq("http://localhost/", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "5.6.7.8" },
    });
    expect(clientFingerprint(req)).toBe("5.6.7.8");
  });

  it("still falls back to x-forwarded-for when nothing better is present", () => {
    const req = mockReq("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9" } });
    expect(clientFingerprint(req)).toBe("1.2.3.4");
  });
});

describe("POST /api/auth/login throttling", () => {
  it("caps failures per ACCOUNT even when the attacker rotates IPs", async () => {
    await mkUser({ email: "victim@club.in", password: "GoodPass1!", role: "COACH" });

    // 10 wrong guesses, each from a different source address. Under the old
    // ${ip}:${email} key every one of these got a fresh allowance.
    for (let i = 0; i < 10; i++) {
      const r = await postLogin({ email: "victim@club.in", password: "wrong" }, `198.51.100.${i}`);
      expect(r.status).toBe(401);
    }

    const r = await postLogin({ email: "victim@club.in", password: "wrong" }, "198.51.100.200");
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: "RATE_LIMITED" });
  });

  it("does not charge successful sign-ins, and forgives earlier fumbles", async () => {
    await mkUser({ email: "fumble@club.in", password: "GoodPass1!", role: "COACH" });

    for (let i = 0; i < 4; i++) {
      expect((await postLogin({ email: "fumble@club.in", password: "wrong" })).status).toBe(401);
    }
    expect((await postLogin({ email: "fumble@club.in", password: "GoodPass1!" })).status).toBe(200);

    // The account counter is cleared, so the next slip starts from zero rather
    // than one away from a lockout.
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: "login:em:fumble@club.in" } });
    expect(rows).toHaveLength(0);
  });

  it("leaves the IP counter alone on success — it isn't one user's to clear", async () => {
    await mkUser({ email: "shared@club.in", password: "GoodPass1!", role: "COACH" });
    await postLogin({ email: "shared@club.in", password: "wrong" }, "203.0.113.77");
    await postLogin({ email: "shared@club.in", password: "GoodPass1!" }, "203.0.113.77");

    const rows = await prisma.rateLimitCounter.findMany({ where: { key: "login:ip:203.0.113.77" } });
    expect(rows[0]?.count).toBe(1);
  });
});
