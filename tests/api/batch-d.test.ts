// Batch D — courses + facility booking + approvals + PDF endpoints.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createCourse } = await import("@/app/api/courses/route");
const { POST: enrolStaff, PATCH: finishEnrolment } = await import("@/app/api/courses/[id]/enrol/route");
const { POST: issueCert } = await import("@/app/api/staff-certifications/route");
const { GET: getCertPdf } = await import("@/app/api/certificates/[id]/pdf/route");
const { POST: bookFacility } = await import("@/app/api/facility-bookings/route");
const { POST: createApproval } = await import("@/app/api/approvals/route");
const { POST: reviewApproval } = await import("@/app/api/approvals/[id]/review/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("Courses + enrolments", () => {
  it("creates a course + enrols a staff user + finishes the enrolment", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createCourse(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "Stable Safety 101",
          durationHrs: 8,
          targetRoles: ["GROOM", "STABLE_MANAGER"],
          passingMark: 70,
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const { id: courseId } = await r.json();

    const enrol = await enrolStaff(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ userId: groom.id }) }) as any,
      { params: { id: courseId } },
    );
    expect(enrol.status).toBe(200);
    const { id: enrolmentId } = await enrol.json();

    // Re-enrol should be idempotent (same row)
    const enrol2 = await enrolStaff(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ userId: groom.id }) }) as any,
      { params: { id: courseId } },
    );
    expect(enrol2.status).toBe(200);
    expect((await enrol2.json()).id).toBe(enrolmentId);

    // Finish it with a pass
    const finish = await finishEnrolment(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ enrolmentId, finalMark: 82, status: "completed" }),
      }) as any,
      { params: { id: courseId } },
    );
    expect(finish.status).toBe(200);

    const after = await prisma.courseEnrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
    expect(after.status).toBe("completed");
    expect(after.finalMark).toBe(82);
  });

  it("issues a staff certification (external — no courseId)", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await issueCert(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          userId: coach.id,
          title: "BHS Stage 3 Coaching",
          issuer: "British Horse Society",
          serialNo: "BHS-3-12345",
          validUntil: "2030-12-31",
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const rows = await prisma.staffCertification.findMany({ where: { userId: coach.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].issuer).toBe("British Horse Society");
    expect(rows[0].validUntil).not.toBeNull();
  });
});

describe("Certificate PDF endpoint", () => {
  it("returns print-ready HTML for a rider certificate", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id, firstName: "Riya", lastName: "Sharma" });
    const cert = await prisma.certificate.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        type: "promotion",
        levelName: "Level 1 — Beginner",
        serialNo: "EW-L1-AAAAAAAA",
        qrCode: "https://example.test/verify/EW-L1-AAAAAAAA",
      },
    });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await getCertPdf(new Request("http://localhost") as any, { params: { id: cert.id } });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("Riya");
    expect(html).toContain("Level 1 — Beginner");
    expect(html).toContain("EW-L1-AAAAAAAA");
  });
});

describe("Facility booking", () => {
  it("books a facility + refuses overlapping bookings", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const facility = await prisma.facility.create({
      data: { centreId: centre.id, name: "Indoor arena", type: "indoor_arena" },
    });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const ok = await bookFacility(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          facilityId: facility.id,
          purpose: "exam",
          title: "L1 promotion exam",
          startAt: "2026-06-01T09:00",
          endAt: "2026-06-01T11:00",
        }),
      }) as any,
    );
    expect(ok.status).toBe(200);

    // Overlap at 10:00–12:00 → should clash
    const clash = await bookFacility(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          facilityId: facility.id,
          purpose: "lesson",
          title: "Pony class",
          startAt: "2026-06-01T10:00",
          endAt: "2026-06-01T12:00",
        }),
      }) as any,
    );
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe("FACILITY_CONFLICT");

    // Back-to-back at 11:00→12:00 is fine
    const okBack = await bookFacility(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          facilityId: facility.id,
          purpose: "lesson",
          title: "Pony class",
          startAt: "2026-06-01T11:00",
          endAt: "2026-06-01T12:00",
        }),
      }) as any,
    );
    expect(okBack.status).toBe(200);
  });

  it("400 INVALID_TIME_RANGE when end <= start", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const facility = await prisma.facility.create({
      data: { centreId: centre.id, name: "X", type: "outdoor_arena" },
    });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await bookFacility(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          facilityId: facility.id,
          purpose: "exam",
          title: "Bad",
          startAt: "2026-06-01T11:00",
          endAt: "2026-06-01T09:00",
        }),
      }) as any,
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("INVALID_TIME_RANGE");
  });
});

describe("Approvals workflow", () => {
  it("creates → notifies manager → approves → notifies requester", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    await loginAs({ userId: groom.id, role: "GROOM", centreId: centre.id, name: groom.name });

    const r = await createApproval(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          entityType: "asset_issuance",
          entityId: "asset_xyz",
          title: "Request to issue saddle SD-12",
          body: "Needed for L3 class on Friday.",
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const { id } = await r.json();

    const mgrInbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(mgrInbox).toHaveLength(1);
    expect(mgrInbox[0].type).toBe("approval.requested");

    // Manager approves
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    const review = await reviewApproval(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "approved", reviewNotes: "OK" }),
      }) as any,
      { params: { id } },
    );
    expect(review.status).toBe(200);

    const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("approved");

    const groomInbox = await prisma.notification.findMany({ where: { userId: groom.id } });
    expect(groomInbox[0].type).toBe("approval.approved");
  });

  it("requester can cancel their own; others get 403", async () => {
    const centre = await mkCentre();
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: (await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id })).id } });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    const other = await mkUser({ role: "GROOM", centreId: centre.id });
    await loginAs({ userId: groom.id, role: "GROOM", centreId: centre.id, name: groom.name });

    const r = await createApproval(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ entityType: "x", entityId: "y", title: "z" }),
      }) as any,
    );
    const { id } = await r.json();

    // Other groom tries to cancel
    await loginAs({ userId: other.id, role: "GROOM", centreId: centre.id, name: other.name });
    const bad = await reviewApproval(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ decision: "cancelled" }) }) as any,
      { params: { id } },
    );
    expect(bad.status).toBe(403);

    // Original requester can
    await loginAs({ userId: groom.id, role: "GROOM", centreId: centre.id, name: groom.name });
    const ok = await reviewApproval(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ decision: "cancelled" }) }) as any,
      { params: { id } },
    );
    expect(ok.status).toBe(200);
  });

  it("non-pending requests cannot be re-reviewed", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    const groom = await mkUser({ role: "GROOM", centreId: centre.id });
    await loginAs({ userId: groom.id, role: "GROOM", centreId: centre.id, name: groom.name });

    const r = await createApproval(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ entityType: "x", entityId: "y", title: "z" }),
      }) as any,
    );
    const { id } = await r.json();

    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });
    await reviewApproval(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ decision: "approved" }) }) as any,
      { params: { id } },
    );
    const second = await reviewApproval(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ decision: "rejected" }) }) as any,
      { params: { id } },
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("ALREADY_REVIEWED");
  });
});
