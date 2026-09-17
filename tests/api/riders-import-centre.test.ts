// Centre resolution on the rider bulk import.
//
// Import is centre-wise, and the centre is NOT in the file — it comes from who
// you are and which centre is selected. Two things had gone wrong there: an HQ
// SUPER_ADMIN (session.centreId = null) could not import at all, and a
// hand-crafted ?centreId= was accepted with no organisation check, which is a
// cross-tenant write.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: importRiders } = await import("@/app/api/riders/import/route");

// school / school_class / school_section are required now; every fixture in
// this file needs all three or the row is rejected before anything else in
// the test gets a chance to run.
const CSV = [
  "first_name,last_name,mobile,dob,emergency_name,emergency_phone,school,school_class,school_section",
  "Aarav,Sharma,9876543210,2014-08-23,Priya Sharma,9876543211,DPS Ghaziabad,7,A",
].join("\n");

// The same rider with no emergency contact — no longer rejected, imported.
const CSV_NO_EMERGENCY = [
  "first_name,last_name,mobile,dob,school,school_class,school_section",
  "Aarav,Sharma,9876543210,2014-08-23,DPS Ghaziabad,7,A",
].join("\n");

// No mobile either. Emergency contact and the rider's own mobile are both
// optional now; school is the column that took over as mandatory.
const CSV_NO_MOBILE_NO_EMERGENCY = [
  "first_name,last_name,dob,school,school_class,school_section",
  "Aarav,Sharma,2014-08-23,DPS Ghaziabad,7,A",
].join("\n");

// School present but class/section missing.
const CSV_NO_CLASS_SECTION = [
  "first_name,last_name,mobile,dob,school",
  "Aarav,Sharma,9876543210,2014-08-23,DPS Ghaziabad",
].join("\n");

// No school at all.
const CSV_NO_SCHOOL = [
  "first_name,last_name,mobile,dob",
  "Aarav,Sharma,9876543210,2014-08-23",
].join("\n");

async function signIn(userId: string, role: Role, centreId: string | null, hqPick?: string) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "T", tokenVersion: 0 }),
  });
  // The top-bar centre picker persists as a cookie; that is how an HQ user
  // chooses a destination.
  if (hqPick) cookieJar.set("ew_hq_centre", { value: hqPick });
}

const call = (query = "") =>
  importRiders(
    mockReq(`http://localhost/api/riders/import${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: CSV, dryRun: true }),
    }),
  );

const importCsv = (csv: string, dryRun = false) =>
  importRiders(
    mockReq("http://localhost/api/riders/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, dryRun }),
    }),
  );

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("rider import — which centre do rows land in?", () => {
  it("a centre manager imports into their own centre", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await signIn(mgr.id, "CENTRE_MANAGER", centre.id);
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ dryRun: true, wouldCreate: 1 });
  });

  it("an HQ super admin can import once a centre is picked", async () => {
    const org = await mkOrg("HQ Org");
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    // This is the case that used to fail outright: session.centreId is null,
    // and the old code resolved that to "" and returned NO_CENTRE_CONTEXT.
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ wouldCreate: 1 });
  });

  it("tells an HQ user on 'All centres' to pick one, rather than failing obscurely", async () => {
    const org = await mkOrg("HQ Org");
    await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null); // no picker cookie
    const r = await call();
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("NO_CENTRE_SELECTED");
    expect(body.message).toMatch(/centre selector/i);
  });

  it("refuses a centre belonging to another organisation", async () => {
    const mine = await mkOrg("Mine");
    const theirs = await mkOrg("Theirs");
    await mkCentre({ orgId: mine.id });
    const foreign = await mkCentre({ orgId: theirs.id, name: "Their Centre" });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: mine.id });
    // A hand-crafted query param aimed at another tenant's centre.
    await signIn(admin.id, "SUPER_ADMIN", null);
    const r = await call(`?centreId=${foreign.id}`);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "FORBIDDEN_CROSS_ORG" });
    expect(await prisma.rider.count({ where: { centreId: foreign.id } })).toBe(0);
  });
});

describe("what the sheet no longer demands", () => {
  // Most riders are minors; the number that matters for contact is a
  // parent's. Requiring the child's own mobile, or an emergency contact
  // before the club had even met the family, blocked school-supplied rosters
  // that only ever carry a class list.
  it("imports a rider with no emergency contact", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const res = await importCsv(CSV_NO_EMERGENCY);
    const body = await res.json();
    expect(body.created).toBe(1);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });
    expect(rider.emergencyName).toBeNull();
    expect(rider.emergencyPhone).toBeNull();
  });

  it("imports a rider with no mobile and no emergency contact at all", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const res = await importCsv(CSV_NO_MOBILE_NO_EMERGENCY);
    const body = await res.json();
    expect(body.created).toBe(1);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });
    expect(rider.mobile).toBeNull();
    expect(rider.emergencyName).toBeNull();
    expect(rider.emergencyPhone).toBeNull();
    expect(rider.school).toBe("DPS Ghaziabad");
  });
});

describe("what the sheet demands instead", () => {
  // School identity is the fence a school administrator's dashboard is
  // scoped by (lib/school-scope.ts). A rider with no school on file is
  // invisible to the school that sent them.
  it("refuses a rider with no school", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const res = await importCsv(CSV_NO_SCHOOL);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(JSON.stringify(body.errors)).toMatch(/school/i);
    expect(await prisma.rider.count()).toBe(0);
  });

  it("refuses a rider with a school but no class or section", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const res = await importCsv(CSV_NO_CLASS_SECTION);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(JSON.stringify(body.errors)).toMatch(/class|section/i);
    expect(await prisma.rider.count()).toBe(0);
  });

  it("resolves the imported rider to a canonical School row", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    await importCsv(CSV);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });
    expect(rider.schoolId).not.toBeNull();
    const school = await prisma.school.findUniqueOrThrow({ where: { id: rider.schoolId! } });
    expect(school.name).toBe("DPS Ghaziabad");
    expect(school.centreId).toBe(centre.id);
  });
});

describe("the duplicate guard without a mobile number", () => {
  // normMobile() used to be called with a guaranteed string; mobile is
  // optional now, so it has to tolerate a null on either side without
  // throwing, and two mobile-less rows for different children must not
  // collide just because both normalise to the same blank key.
  it("still catches a duplicate row inside one sheet when both are mobile-less", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const csv = [
      "first_name,last_name,dob,school,school_class,school_section",
      "Aarav,Sharma,2014-08-23,DPS Ghaziabad,7,A",
      "Aarav,Sharma,2014-08-23,DPS Ghaziabad,7,A",
    ].join("\n");
    const res = await importCsv(csv);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.errors.length).toBe(1);
  });

  it("does not confuse two different mobile-less siblings", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);
    const csv = [
      "first_name,last_name,dob,school,school_class,school_section",
      "Aarav,Sharma,2014-08-23,DPS Ghaziabad,7,A",
      "Diya,Sharma,2016-01-09,DPS Ghaziabad,5,B",
    ].join("\n");
    const res = await importCsv(csv);
    const body = await res.json();
    expect(body.created).toBe(2);
  });
});

describe("captures height, weight and BMI the same way registration does", () => {
  it("derives BMI from height and weight", async () => {
    // Asked for on the wizard and never added here, so an imported rider had
    // no BMI — the figure the club uses when matching a rider to a horse. A
    // pony has a weight limit; this is a safety number, not a health metric.
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);

    const csv = [
      "first_name,last_name,mobile,dob,school,school_class,school_section,height_cm,weight_kg,allergies",
      "Aarav,Sharma,9876543210,2014-08-23,DPS Ghaziabad,7,A,140,35,Hay and dust",
    ].join("\n");
    await importCsv(csv);

    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });
    expect(rider.heightCm).toBe(140);
    expect(rider.weightKg).toBe(35);
    // 35 / 1.4^2 = 17.9 — identical to what the wizard would store.
    expect(rider.bmi).toBe(17.9);
    expect(rider.bmiMeasuredAt).not.toBeNull();
    // The one a stable cares about most.
    expect(rider.allergies).toBe("Hay and dust");
  });

  it("leaves BMI null when either measurement is missing", async () => {
    // Half a measurement is not a BMI, and inventing one would put a number
    // on a rider profile that nobody measured.
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await signIn(admin.id, "SUPER_ADMIN", null, centre.id);

    const csv = [
      "first_name,last_name,mobile,dob,school,school_class,school_section,height_cm",
      "Solo,Height,9876543212,2014-08-23,DPS Ghaziabad,7,A,140",
    ].join("\n");
    await importCsv(csv);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Solo" } });
    expect(rider.heightCm).toBe(140);
    expect(rider.bmi).toBeNull();
    expect(rider.bmiMeasuredAt).toBeNull();
  });
});
