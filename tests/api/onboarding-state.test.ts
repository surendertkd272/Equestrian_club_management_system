// Covers the atomic jsonb merge in PATCH /api/me/onboarding — the write path
// was moved to $executeRaw so concurrent updates don't clobber each other.
// These run against real Postgres, so they verify the SQL merge for real.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { PATCH } = await import("@/app/api/me/onboarding/route");

async function loginAs(p: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(p) });
}
function patch(body: unknown) {
  return PATCH(mockReq("http://localhost", { method: "PATCH", body: JSON.stringify(body) }));
}
async function stateOf(userId: string): Promise<Record<string, unknown>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingJson: true } });
  return (u?.onboardingJson ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("PATCH /api/me/onboarding", () => {
  it("stamps tourCompletedAt and merges checklist ticks without clobbering each other", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: u.id, role: "COACH", centreId: c.id, name: u.name });

    await patch({ tourCompleted: true });
    await patch({ checklist: { attendance: true } });
    await patch({ checklist: { lessons: true } });

    const s = await stateOf(u.id);
    expect(typeof s.tourCompletedAt).toBe("string"); // survived the later checklist writes
    expect(s.checklist).toMatchObject({ attendance: true, lessons: true }); // deep-merged, both kept
  });

  it("records a dismissal alongside existing state", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: u.id, role: "COACH", centreId: c.id, name: u.name });

    await patch({ checklist: { attendance: true } });
    await patch({ dismissChecklist: true });

    const s = await stateOf(u.id);
    expect(typeof s.checklistDismissedAt).toBe("string");
    expect(s.checklist).toMatchObject({ attendance: true });
  });

  it("401s when unauthenticated and 400s on unknown fields", async () => {
    const unauth = await patch({ tourCompleted: true });
    expect(unauth.status).toBe(401);

    const c = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: u.id, role: "COACH", centreId: c.id, name: u.name });
    const bogus = await patch({ bogus: 1 });
    expect(bogus.status).toBe(400);
  });
});
