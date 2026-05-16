import { describe, it, expect } from "vitest";
import { scopeCentre, centreWhere } from "./tenancy";
import type { SessionPayload } from "./auth";

function mkSession(over: Partial<SessionPayload>): SessionPayload {
  return {
    userId: "u_1",
    role: "CENTRE_MANAGER",
    centreId: "c_home",
    name: "Test",
    ...over,
  };
}

describe("scopeCentre", () => {
  it("SUPER_ADMIN: no requested centre → null (HQ, all centres)", () => {
    const s = mkSession({ role: "SUPER_ADMIN", centreId: null });
    expect(scopeCentre(s)).toBeNull();
    expect(scopeCentre(s, null)).toBeNull();
  });
  it("SUPER_ADMIN: requested centre is passed through", () => {
    const s = mkSession({ role: "SUPER_ADMIN", centreId: null });
    expect(scopeCentre(s, "c_other")).toBe("c_other");
  });

  it("non-admin: locked to own centre when no request", () => {
    const s = mkSession({ role: "CENTRE_MANAGER", centreId: "c_home" });
    expect(scopeCentre(s)).toBe("c_home");
  });
  it("non-admin: own centre echo is allowed", () => {
    const s = mkSession({ role: "CENTRE_MANAGER", centreId: "c_home" });
    expect(scopeCentre(s, "c_home")).toBe("c_home");
  });
  it("non-admin: cross-centre request throws", () => {
    const s = mkSession({ role: "CENTRE_MANAGER", centreId: "c_home" });
    expect(() => scopeCentre(s, "c_other")).toThrow("FORBIDDEN_CROSS_CENTRE");
  });
  it("non-admin without centreId throws USER_HAS_NO_CENTRE", () => {
    const s = mkSession({ role: "COACH", centreId: null });
    expect(() => scopeCentre(s)).toThrow("USER_HAS_NO_CENTRE");
  });
});

describe("centreWhere", () => {
  it("returns { centreId } when scoped", () => {
    expect(centreWhere("c_1")).toEqual({ centreId: "c_1" });
  });
  it("returns empty object when null (HQ — no scope filter)", () => {
    expect(centreWhere(null)).toEqual({});
  });
});
