// Regression for two audit-2 highs:
//   1. /api/certificates/[id]/pdf leaked certs across centres (no centre guard).
//   2. ExamLevel (shared platform catalog) was writable by per-tenant ADMIN.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider } from "../helpers/fixtures";
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

const { GET: certPdf } = await import("@/app/api/certificates/[id]/pdf/route");
const { PATCH: examLevelPatch } = await import("@/app/api/exam-levels/[id]/route");

async function login(u: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
});

describe("certificate PDF cross-centre isolation", () => {
  it("a centre-scoped user cannot pull another centre's certificate PDF", async () => {
    const org = await mkOrg();
    const centreX = await mkCentre({ orgId: org.id });
    const centreY = await mkCentre({ orgId: org.id });
    const coachX = await mkUser({ role: "COACH", centreId: centreX.id, name: "Coach X" });
    const riderY = await mkRider({ centreId: centreY.id });
    const certY = await prisma.certificate.create({
      data: { centreId: centreY.id, riderId: riderY.id, type: "participation", serialNo: "SN-Y-1", qrCode: "qr-y", levelName: "Level 1" },
    });

    await login(coachX);
    const res = await certPdf(mockReq(`http://localhost/api/certificates/${certY.id}/pdf`), { params: { id: certY.id } });
    expect(res.status).toBe(404); // cross-centre → not found

    // Own centre's cert renders.
    const riderX = await mkRider({ centreId: centreX.id });
    const certX = await prisma.certificate.create({
      data: { centreId: centreX.id, riderId: riderX.id, type: "participation", serialNo: "SN-X-1", qrCode: "qr-x", levelName: "Level 1" },
    });
    await login(coachX);
    const ok = await certPdf(mockReq(`http://localhost/api/certificates/${certX.id}/pdf`), { params: { id: certX.id } });
    expect(ok.status).toBe(200);
  });
});

describe("ExamLevel write lockdown", () => {
  it("a per-tenant ADMIN cannot edit the shared exam-level catalog; SUPER_ADMIN can", async () => {
    const org = await mkOrg();
    const admin = await mkUser({ role: "ADMIN", centreId: null, orgId: org.id, name: "Admin" });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, name: "SU" });
    const level = await prisma.examLevel.create({ data: { orderIndex: 1, code: "L1", name: "Level 1", passThreshold: 70 } });

    await login(admin);
    const denied = await examLevelPatch(
      mockReq(`http://localhost/api/exam-levels/${level.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hacked" }) }),
      { params: { id: level.id } },
    );
    expect(denied.status).toBe(403);
    expect((await prisma.examLevel.findUniqueOrThrow({ where: { id: level.id } })).name).toBe("Level 1");

    await login(su);
    const ok = await examLevelPatch(
      mockReq(`http://localhost/api/exam-levels/${level.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Level One" }) }),
      { params: { id: level.id } },
    );
    expect(ok.status).toBe(200);
    expect((await prisma.examLevel.findUniqueOrThrow({ where: { id: level.id } })).name).toBe("Level One");
  });
});
