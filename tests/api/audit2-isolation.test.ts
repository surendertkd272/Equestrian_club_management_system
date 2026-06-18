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
const { PATCH: centrePatch } = await import("@/app/api/centres/[id]/route");
const { POST: staffCertPost } = await import("@/app/api/staff-certifications/route");
const { POST: enrolPost } = await import("@/app/api/courses/[id]/enrol/route");

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

describe("centre cross-org write lockdown", () => {
  it("a per-tenant ADMIN cannot edit another org's centre; same-org + SUPER_ADMIN can", async () => {
    const orgA = await mkOrg("Org A");
    const orgB = await mkOrg("Org B");
    const centreA = await mkCentre({ orgId: orgA.id });
    const centreB = await mkCentre({ orgId: orgB.id });
    const adminA = await mkUser({ role: "ADMIN", centreId: null, orgId: orgA.id, name: "Admin A" });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: orgA.id, name: "SU" });

    const patch = (id: string, name: string) =>
      centrePatch(
        mockReq(`http://localhost/api/centres/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
        { params: { id } },
      );

    // ADMIN of org A → org B's centre is invisible (404) and unchanged.
    await login(adminA);
    const denied = await patch(centreB.id, "Hijacked");
    expect(denied.status).toBe(404);
    expect((await prisma.centre.findUniqueOrThrow({ where: { id: centreB.id } })).name).not.toBe("Hijacked");

    // ADMIN of org A → own org's centre is editable.
    await login(adminA);
    expect((await patch(centreA.id, "Renamed A")).status).toBe(200);
    expect((await prisma.centre.findUniqueOrThrow({ where: { id: centreA.id } })).name).toBe("Renamed A");

    // SUPER_ADMIN (platform owner) → any centre, including org B.
    await login(su);
    expect((await patch(centreB.id, "Renamed B")).status).toBe(200);
    expect((await prisma.centre.findUniqueOrThrow({ where: { id: centreB.id } })).name).toBe("Renamed B");
  });
});

describe("staff foreign-id write lockdown", () => {
  it("staff-cert + course-enrol reject a user from another centre (and ignore body.centreId)", async () => {
    const org = await mkOrg();
    const cX = await mkCentre({ orgId: org.id });
    const cY = await mkCentre({ orgId: org.id });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: cX.id, name: "Mgr X" });
    const userX = await mkUser({ role: "COACH", centreId: cX.id, name: "Coach X" });
    const userY = await mkUser({ role: "COACH", centreId: cY.id, name: "Coach Y" });
    const courseX = await prisma.course.create({ data: { centreId: cX.id, title: "First Aid" } });

    // staff-cert: issuing to a user in another centre is rejected even though the
    // body claims the caller's own centreId; own-centre user succeeds.
    await login(mgr);
    const certBad = await staffCertPost(mockReq("http://localhost/api/staff-certifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: userY.id, title: "BHS", centreId: cX.id }) }));
    expect(certBad.status).toBe(403);
    await login(mgr);
    const certOk = await staffCertPost(mockReq("http://localhost/api/staff-certifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: userX.id, title: "BHS" }) }));
    expect(certOk.status).toBe(200);
    expect((await prisma.staffCertification.findFirstOrThrow({ where: { userId: userX.id } })).centreId).toBe(cX.id);

    // enrol: a user from another centre can't be enrolled into cX's course.
    await login(mgr);
    const enrolBad = await enrolPost(mockReq(`http://localhost/api/courses/${courseX.id}/enrol`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: userY.id }) }), { params: { id: courseX.id } });
    expect(enrolBad.status).toBe(403);
    await login(mgr);
    const enrolOk = await enrolPost(mockReq(`http://localhost/api/courses/${courseX.id}/enrol`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: userX.id }) }), { params: { id: courseX.id } });
    expect(enrolOk.status).toBe(200);
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
