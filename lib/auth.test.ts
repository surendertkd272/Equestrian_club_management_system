import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Stub next/headers — it errors when called outside a Next request scope.
// We don't exercise the cookie helpers here; this just lets lib/auth.ts import cleanly.
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

const SECRET = "test-jwt-secret-please-ignore";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

afterEach(() => {
  process.env.JWT_SECRET = SECRET;
});

// Import after the env is set so JWT_SECRET is read consistently.
const { hashPassword, verifyPassword, signSession, verifySession } = await import("./auth");

describe("hashPassword / verifyPassword", () => {
  it("hash does not equal the plain password", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(hash.length).toBeGreaterThan(20); // bcrypt hashes are ~60 chars
  });
  it("verifyPassword accepts the correct plain", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });
  it("verifyPassword rejects an incorrect plain", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("signSession / verifySession", () => {
  const payload = {
    userId: "u_123",
    role: "CENTRE_MANAGER" as const,
    centreId: "c_456",
    name: "Manager Manjit",
  };

  it("roundtrips a session token", async () => {
    const token = await signSession(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT shape: header.body.sig

    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(payload.userId);
    expect(verified?.role).toBe(payload.role);
    expect(verified?.centreId).toBe(payload.centreId);
    expect(verified?.name).toBe(payload.name);
  });

  it("returns null for a tampered token", async () => {
    const token = await signSession(payload);
    // Reverse the entire signature — guarantees a tamper that fails verification.
    // A single-char flip can occasionally land on a base64url char that doesn't
    // change the underlying signature bytes (very rare, but enough to flake CI).
    const parts = token.split(".");
    parts[2] = parts[2].split("").reverse().join("");
    const tampered = parts.join(".");
    expect(await verifySession(tampered)).toBeNull();
  });

  it("returns null for a garbage token", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("returns null when verified with a different secret", async () => {
    const token = await signSession(payload);
    process.env.JWT_SECRET = "different-secret";
    expect(await verifySession(token)).toBeNull();
  });
});
