// Regression tests for the two authz reds:
//   1. Cross-org user writes — User is RLS-permissive, so the app layer must
//      stop an HQ admin of org A from mutating org B's users.
//   2. Staff-onboarding approval privilege escalation — a CENTRE_MANAGER must
//      not be able to mint a SUPER_ADMIN/ADMIN account.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkUser, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { PATCH, DELETE } = await import("@/app/api/users/[id]/route");
const { POST: resetPwd } = await import("@/app/api/users/[id]/reset-password/route");
const { POST: approveOnboarding } = await import("@/app/api/staff-onboarding/[id]/approve/route");

async function loginAs(u: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
function jsonReq(url: string, body: unknown, method = "POST") {
  return mockReq(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await resetDb();
});

describe("cross-org user-write isolation", () => {
  it("an HQ admin cannot PATCH / reset-password / DELETE a user in another org", async () => {
    const orgA = await mkOrg("Org A");
    const orgB = await mkOrg("Org B");
    const adminA = await mkUser({ role: "SUPER_ADMIN", orgId: orgA.id, name: "Admin A" });
    const centreB = await mkCentre({ orgId: orgB.id });
    const victimB = await mkUser({ role: "COACH", centreId: centreB.id, name: "Victim B" });

    await loginAs(adminA);
    const patch = await PATCH(jsonReq(`http://localhost/api/users/${victimB.id}`, { status: "suspended" }, "PATCH"), { params: { id: victimB.id } });
    expect(patch.status).toBe(403);
    expect((await patch.json()).error).toBe("FORBIDDEN_CROSS_ORG");

    await loginAs(adminA);
    const reset = await resetPwd(jsonReq(`http://localhost/api/users/${victimB.id}/reset-password`, {}), { params: { id: victimB.id } });
    expect(reset.status).toBe(403);

    await loginAs(adminA);
    const del = await DELETE(mockReq(`http://localhost/api/users/${victimB.id}`, { method: "DELETE" }), { params: { id: victimB.id } });
    expect(del.status).toBe(403);

    // Victim is untouched.
    const still = await prisma.user.findUnique({ where: { id: victimB.id } });
    expect(still?.status).toBe("active");
  });

  it("an HQ admin CAN PATCH a user in their own org", async () => {
    const orgA = await mkOrg("Org A");
    const adminA = await mkUser({ role: "SUPER_ADMIN", orgId: orgA.id, name: "Admin A" });
    const centreA = await mkCentre({ orgId: orgA.id });
    const mate = await mkUser({ role: "COACH", centreId: centreA.id, name: "Mate" });

    await loginAs(adminA);
    const res = await PATCH(jsonReq(`http://localhost/api/users/${mate.id}`, { status: "suspended" }, "PATCH"), { params: { id: mate.id } });
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mate.id } })).status).toBe("suspended");
  });
});

describe("staff-onboarding approval — privilege escalation guard", () => {
  it("a CENTRE_MANAGER cannot approve an onboarding into a SUPER_ADMIN role", async () => {
    const orgA = await mkOrg("Org A");
    const centreA = await mkCentre({ orgId: orgA.id });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centreA.id, name: "Mgr" });

    await loginAs(mgr);
    // The role guard fires before any DB read, so a dummy id is fine.
    const res = await approveOnboarding(jsonReq(`http://localhost/api/staff-onboarding/x/approve`, { role: "SUPER_ADMIN" }), { params: { id: "x" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_ROLE");
    expect(await prisma.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
  });

  it("ADMIN is likewise rejected as a target role", async () => {
    const orgA = await mkOrg("Org A");
    const centreA = await mkCentre({ orgId: orgA.id });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centreA.id, name: "Mgr" });
    await loginAs(mgr);
    const res = await approveOnboarding(jsonReq(`http://localhost/api/staff-onboarding/x/approve`, { role: "ADMIN" }), { params: { id: "x" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_ROLE");
  });
});
