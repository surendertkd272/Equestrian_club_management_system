// Fencing a school administrator to their own pupils.
//
// The role was scoped to a CENTRE, so an administrator saw every child at
// their club whatever school the child attended. Fine while a centre serves
// one school; GHRC Equiwings already carries riders from four, so handing any
// one of those schools a login would have shown them the others' children.
//
// The tests that matter here are the negative ones. A fence is only worth
// having if it holds on every surface — and the ways it leaks are indirect:
// attendance reached through a shared batch, exams reached through a centre.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider, mkBatch } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import {
  schoolScopeFor,
  riderScopeWhere,
  resolveSchoolId,
  schoolFenceFor,
  isOutsideSchoolFence,
} from "@/lib/school-scope";
import type { Role } from "@/lib/roles";
import type { SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: createSchool, PATCH: assignAdmin } = await import("@/app/api/schools/route");
const { GET: exportCsv } = await import("@/app/api/export/[entity]/route");
const { PATCH: decideEnrolment } = await import("@/app/api/enrolments/[id]/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let dps: { id: string };
let prakriti: { id: string };

async function signIn(userId: string, role: Role, centreId: string | null, hqPick?: string) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "T", tokenVersion: 0 }),
  });
  if (hqPick) cookieJar.set("ew_hq_centre", { value: hqPick });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("School Scope Org");
  centre = await mkCentre({ orgId: org.id, name: "GHRC" });
  dps = await prisma.school.create({ data: { centreId: centre.id, name: "DPS Ghaziabad" } });
  prakriti = await prisma.school.create({ data: { centreId: centre.id, name: "Prakriti" } });
});

describe("the fence itself", () => {
  it("shows only their own school's children once a school is set", async () => {
    const mine = await mkRider({ centreId: centre.id, firstName: "Mine" });
    const theirs = await mkRider({ centreId: centre.id, firstName: "Theirs" });
    await prisma.rider.update({ where: { id: mine.id }, data: { schoolId: dps.id } });
    await prisma.rider.update({ where: { id: theirs.id }, data: { schoolId: prakriti.id } });

    const admin = await mkUser({
      email: "dps@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    await prisma.user.update({ where: { id: admin.id }, data: { schoolId: dps.id } });

    const scope = await schoolScopeFor(admin.id);
    const rows = await prisma.rider.findMany({
      where: riderScopeWhere(centre.id, scope),
      select: { firstName: true },
    });
    expect(rows.map((r) => r.firstName)).toEqual(["Mine"]);
  });

  it("still shows the whole centre when no school is set", async () => {
    // Every account that existed before schools did has schoolId = NULL, so
    // this is the migration-day behaviour. Narrowing it silently would have
    // emptied four live dashboards.
    await mkRider({ centreId: centre.id, firstName: "A" });
    const b = await mkRider({ centreId: centre.id, firstName: "B" });
    await prisma.rider.update({ where: { id: b.id }, data: { schoolId: dps.id } });

    const admin = await mkUser({
      email: "all@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    const scope = await schoolScopeFor(admin.id);
    expect(scope.schoolId).toBeNull();
    const rows = await prisma.rider.findMany({ where: riderScopeWhere(centre.id, scope) });
    expect(rows).toHaveLength(2);
  });

  it("does not leak another school's register through a shared batch", async () => {
    // The real shape of the bug. Pupils of both schools sit in the SAME 6am
    // batch, so the attendance roll-up filtered by batch.centreId — which
    // returned every child at the club no matter whose dashboard it was.
    const batch = await mkBatch({ centreId: centre.id, name: "6am" });
    const mine = await mkRider({ centreId: centre.id, firstName: "Mine" });
    const theirs = await mkRider({ centreId: centre.id, firstName: "Theirs" });
    await prisma.rider.update({ where: { id: mine.id }, data: { schoolId: dps.id } });
    await prisma.rider.update({ where: { id: theirs.id }, data: { schoolId: prakriti.id } });
    for (const r of [mine, theirs]) {
      await prisma.attendance.create({
        data: { riderId: r.id, batchId: batch.id, date: new Date(), status: "present" },
      });
    }

    const scope = { schoolId: dps.id, schoolName: "DPS Ghaziabad" };
    const rows = await prisma.attendance.groupBy({
      by: ["riderId", "status"],
      where: { rider: riderScopeWhere(centre.id, scope) },
      _count: { _all: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].riderId).toBe(mine.id);
  });

  it("does not leak another school's exams", async () => {
    const theirs = await mkRider({ centreId: centre.id, firstName: "Theirs" });
    await prisma.rider.update({ where: { id: theirs.id }, data: { schoolId: prakriti.id } });
    await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: theirs.id,
        examinerName: "E",
        level: 1,
        date: new Date(),
        status: "completed",
      },
    });

    const scope = { schoolId: dps.id, schoolName: "DPS Ghaziabad" };
    const rows = await prisma.exam.findMany({ where: { rider: riderScopeWhere(centre.id, scope) } });
    expect(rows).toHaveLength(0);
  });
});

describe("the same fence outside the portal", () => {
  // The fence stopped at /school/*. The staff PAGES bounce this role back to
  // /school at the admin layout, but two surfaces outside the portal do not:
  // the CSV export (gated on rider.read, which this role holds) and the
  // enrolment decision API (its one write). Both were centre-scoped only.

  async function fencedAdmin(email = "fenced@club.in") {
    const admin = await mkUser({ email, role: "SCHOOL_ADMINISTRATOR", centreId: centre.id });
    await prisma.user.update({ where: { id: admin.id }, data: { schoolId: dps.id } });
    return admin;
  }

  const sessionFor = (userId: string, role: Role): SessionPayload =>
    ({ userId, role, centreId: centre.id, name: "T" }) as SessionPayload;

  it("narrows a fenced administrator and nobody else", async () => {
    const fenced = await fencedAdmin();
    const open = await mkUser({
      email: "open@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    const mgr = await mkUser({ email: "mgr@club.in", role: "CENTRE_MANAGER", centreId: centre.id });

    expect(await schoolFenceFor(sessionFor(fenced.id, "SCHOOL_ADMINISTRATOR"))).toEqual({
      schoolId: dps.id,
    });
    // Unfenced administrator: the whole centre, as on migration day.
    expect(await schoolFenceFor(sessionFor(open.id, "SCHOOL_ADMINISTRATOR"))).toEqual({});
    // A centre manager runs the club and must keep seeing all of it.
    expect(await schoolFenceFor(sessionFor(mgr.id, "CENTRE_MANAGER"))).toEqual({});
  });

  it("keeps another school's child off a page reached by id", async () => {
    // A list can be filtered; a profile is fetched by the id in the URL. This
    // is the guard behind /riders/[id], /reports/[riderId] and the rest.
    const fenced = await fencedAdmin();
    const session = sessionFor(fenced.id, "SCHOOL_ADMINISTRATOR");
    expect(await isOutsideSchoolFence(session, dps.id)).toBe(false);
    expect(await isOutsideSchoolFence(session, prakriti.id)).toBe(true);
    // A child with no school at all is not one of theirs either.
    expect(await isOutsideSchoolFence(session, null)).toBe(true);

    const mgr = await mkUser({ email: "mgr2@club.in", role: "CENTRE_MANAGER", centreId: centre.id });
    expect(await isOutsideSchoolFence(sessionFor(mgr.id, "CENTRE_MANAGER"), prakriti.id)).toBe(false);
  });

  it("does not export another school's roster", async () => {
    // The widest surface: rider.read is what this export is gated on, and a
    // school administrator holds it — for their own pupils. One click gave
    // them every other family's name, mobile and email in a file.
    const mine = await mkRider({ centreId: centre.id, firstName: "Mine", mobile: "9000000001" });
    const theirs = await mkRider({ centreId: centre.id, firstName: "Theirs", mobile: "9000000002" });
    await prisma.rider.update({ where: { id: mine.id }, data: { schoolId: dps.id } });
    await prisma.rider.update({ where: { id: theirs.id }, data: { schoolId: prakriti.id } });

    const admin = await fencedAdmin();
    await signIn(admin.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await exportCsv(mockReq("http://localhost/api/export/riders"), {
      params: { entity: "riders" },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Mine");
    expect(csv).not.toContain("Theirs");
    expect(csv).not.toContain("9000000002");
  });

  it("does not export another school's register through a shared batch", async () => {
    const batch = await mkBatch({ centreId: centre.id, name: "6am" });
    const mine = await mkRider({ centreId: centre.id, firstName: "Mine" });
    const theirs = await mkRider({ centreId: centre.id, firstName: "Theirs" });
    await prisma.rider.update({ where: { id: mine.id }, data: { schoolId: dps.id } });
    await prisma.rider.update({ where: { id: theirs.id }, data: { schoolId: prakriti.id } });
    for (const r of [mine, theirs]) {
      await prisma.attendance.create({
        data: { riderId: r.id, batchId: batch.id, date: new Date(), status: "present" },
      });
    }

    const admin = await fencedAdmin();
    await signIn(admin.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await exportCsv(mockReq("http://localhost/api/export/attendance"), {
      params: { entity: "attendance" },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Mine");
    expect(csv).not.toContain("Theirs");
  });

  it("refuses a decision on another school's sign-up", async () => {
    // Not a read: approving or rejecting is the one write this role has, and
    // a club serving four schools would have let any one of them decide
    // another school's child.
    const r = await mkRider({ centreId: centre.id, firstName: "Theirs" });
    await prisma.rider.update({
      where: { id: r.id },
      data: { schoolId: prakriti.id, status: "pending_approval", selfEnrolled: true },
    });

    const admin = await fencedAdmin();
    await signIn(admin.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await decideEnrolment(
      mockReq(`http://localhost/api/enrolments/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: "not ours" }),
      }),
      { params: { id: r.id } },
    );
    expect(res.status).toBe(403);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      "pending_approval",
    );
  });

  it("still lets them decide their own school's sign-up", async () => {
    // The fence has to hold without taking away the one action this role has.
    const r = await mkRider({ centreId: centre.id, firstName: "Mine" });
    await prisma.rider.update({
      where: { id: r.id },
      data: { schoolId: dps.id, status: "pending_approval", selfEnrolled: true },
    });

    const admin = await fencedAdmin();
    await signIn(admin.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await decideEnrolment(
      mockReq(`http://localhost/api/enrolments/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: "duplicate" }),
      }),
      { params: { id: r.id } },
    );
    expect(res.status).toBe(200);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("rejected");
  });
});

describe("resolving a typed school name", () => {
  it("folds whitespace variants onto one row", async () => {
    // "Prakriti" and "Prakriti " are two strings and were two schools, so one
    // child sat outside their own school's view. This is why the fence could
    // not be free text.
    const a = await resolveSchoolId(prisma, centre.id, "Prakriti");
    const b = await resolveSchoolId(prisma, centre.id, "  Prakriti  ");
    expect(a).toBe(prakriti.id);
    expect(b).toBe(prakriti.id);
  });

  it("creates a school the first time a new name appears", async () => {
    const id = await resolveSchoolId(prisma, centre.id, "Prometheus School");
    expect(id).toBeTruthy();
    const row = await prisma.school.findUniqueOrThrow({ where: { id: id! } });
    expect(row.name).toBe("Prometheus School");
    expect(row.centreId).toBe(centre.id);
  });

  it("treats blanks and non-answers as no school", async () => {
    // Minting a school called "Nil" that somebody could later be fenced to is
    // worse than recording nothing.
    for (const v of ["", "   ", "nil", "NA", "n/a", "None", "-"]) {
      expect(await resolveSchoolId(prisma, centre.id, v)).toBeNull();
    }
    expect(await prisma.school.count({ where: { centreId: centre.id } })).toBe(2);
  });

  it("keeps the same name at two centres as two rows", async () => {
    // One school can genuinely partner with two clubs; merging them would let
    // one centre's administrator see the other's children.
    const other = await mkCentre({ orgId: org.id, name: "Other Centre" });
    const a = await resolveSchoolId(prisma, centre.id, "Shared School");
    const b = await resolveSchoolId(prisma, other.id, "Shared School");
    expect(a).not.toBe(b);
  });
});

describe("who may move the fence", () => {
  const call = (body: unknown, method: "POST" | "PATCH") =>
    (method === "POST" ? createSchool : assignAdmin)(
      mockReq("http://localhost/api/schools", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("refuses a coach", async () => {
    const coach = await mkUser({ email: "c@club.in", role: "COACH", centreId: centre.id });
    await signIn(coach.id, "COACH", centre.id);
    expect((await call({ name: "Sneaky School" }, "POST")).status).toBe(403);
  });

  it("refuses a school administrator moving their own fence", async () => {
    // The obvious escalation: widen yourself to the whole centre.
    const admin = await mkUser({
      email: "sa@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    await prisma.user.update({ where: { id: admin.id }, data: { schoolId: dps.id } });
    await signIn(admin.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await call({ userId: admin.id, schoolId: null }, "PATCH");
    expect(res.status).toBe(403);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.schoolId).toBe(dps.id);
  });

  it("will not fence an account to another centre's school", async () => {
    const otherOrg = await mkOrg("Other Org");
    const otherCentre = await mkCentre({ orgId: otherOrg.id, name: "Elsewhere" });
    const foreign = await prisma.school.create({
      data: { centreId: otherCentre.id, name: "Foreign School" },
    });
    const admin = await mkUser({
      email: "sa2@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    const mgr = await mkUser({ email: "m@club.in", role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);

    const res = await call({ userId: admin.id, schoolId: foreign.id }, "PATCH");
    expect(res.status).toBe(404);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.schoolId).toBeNull();
  });

  it("lets a centre manager fence and unfence their own administrator", async () => {
    const admin = await mkUser({
      email: "sa3@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    const mgr = await mkUser({ email: "m2@club.in", role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);

    expect((await call({ userId: admin.id, schoolId: dps.id }, "PATCH")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).schoolId).toBe(dps.id);

    expect((await call({ userId: admin.id, schoolId: null }, "PATCH")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).schoolId).toBeNull();
  });

  it("refuses to attach a non-school-admin", async () => {
    const coach = await mkUser({ email: "c2@club.in", role: "COACH", centreId: centre.id });
    const mgr = await mkUser({ email: "m3@club.in", role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);
    const res = await call({ userId: coach.id, schoolId: dps.id }, "PATCH");
    expect(res.status).toBe(404);
  });

  it("records who moved a fence", async () => {
    const admin = await mkUser({
      email: "sa4@club.in",
      role: "SCHOOL_ADMINISTRATOR",
      centreId: centre.id,
    });
    const mgr = await mkUser({ email: "m4@club.in", role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);
    await call({ userId: admin.id, schoolId: dps.id }, "PATCH");
    const entry = await prisma.auditLog.findFirst({ where: { action: "school.assign_admin" } });
    expect(entry).not.toBeNull();
  });
});
