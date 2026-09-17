// Bulk staff intake.
//
// Riders have had a bulk upload for a long time; staff never did, so a club
// opening with twenty employees typed them in one form at a time — at exactly
// the moment nobody has an afternoon spare.
//
// The things worth pinning down here are the ones where a bulk path could
// quietly become weaker than the single-record path it stands next to: who may
// call it, which centre the rows land in, whether a job title can be guessed
// at, and where the passwords end up.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME, verifyPassword } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import { revealIssuedCredential } from "@/lib/issued-credential";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: importStaff } = await import("@/app/api/staff/import/route");

const CSV = [
  "name,email,role,phone,salary_band,joining_date",
  "Ravi Kumar,ravi@club.in,COACH,9876543210,C2,2026-04-01",
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

const call = (body: unknown, query = "") =>
  importStaff(
    mockReq(`http://localhost/api/staff/import${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let manager: Awaited<ReturnType<typeof mkUser>>;

// The local .env deliberately has no PII key (encryption is provisioned per
// environment) and storeIssuedCredential fails closed without one — correctly,
// since the alternative is writing passwords to the database in cleartext.
// Give the suite its own key so these exercise the feature rather than the
// dormant path.
process.env.PII_ENCRYPTION_KEY = "9Ip0aMPmSDb7bXKukyxYUOqXd9uLFtA0RJvVLwBk2mY=";

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Import Org");
  centre = await mkCentre({ orgId: org.id, name: "Import Centre" });
  manager = await mkUser({
    email: "mgr@club.in",
    role: "CENTRE_MANAGER",
    centreId: centre.id,
  });
});

describe("who may bulk-create staff", () => {
  it("refuses a coach", async () => {
    const coach = await mkUser({ email: "coach@club.in", role: "COACH", centreId: centre.id });
    await signIn(coach.id, "COACH", centre.id);
    const res = await call({ csv: CSV, dryRun: true });
    // A coach cannot Add Staff either. Bulk must never be the soft spot —
    // creating accounts is the privilege-escalation surface on this app.
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    cookieJar.clear();
    const res = await call({ csv: CSV, dryRun: true });
    expect(res.status).toBe(401);
  });

  it("allows a centre manager", async () => {
    await signIn(manager.id, "CENTRE_MANAGER", centre.id);
    const res = await call({ csv: CSV, dryRun: true });
    expect(res.status).toBe(200);
  });
});

describe("which centre the rows land in", () => {
  it("lets an HQ super-admin import into the centre they picked", async () => {
    // SUPER_ADMIN has centreId = null. Reading session.centreId directly is the
    // recurring bug that locks HQ out of precisely the screens they need when
    // standing a new club up.
    // HQ users carry orgId directly — they have no centre to derive it from.
    const hq = await mkUser({
      email: "hq@club.in",
      role: "SUPER_ADMIN",
      centreId: null,
      orgId: org.id,
    });
    await signIn(hq.id, "SUPER_ADMIN", null, centre.id);
    const res = await call({ csv: CSV });
    expect(res.status).toBe(200);
    const staff = await prisma.staff.findFirstOrThrow({ include: { user: true } });
    expect(staff.centreId).toBe(centre.id);
    expect(staff.user.centreId).toBe(centre.id);
  });

  it("refuses to write into another organisation's centre", async () => {
    const otherOrg = await mkOrg("Other Org");
    const otherCentre = await mkCentre({ orgId: otherOrg.id, name: "Other Centre" });
    await signIn(manager.id, "CENTRE_MANAGER", centre.id);
    const res = await call({ csv: CSV }, `?centreId=${otherCentre.id}`);
    // Whether it is refused outright or pinned back to the caller's own centre,
    // the one outcome that must never happen is a row in the other tenant.
    const leaked = await prisma.staff.count({ where: { centreId: otherCentre.id } });
    expect(leaked).toBe(0);
    expect(res.status === 403 || res.status === 200).toBe(true);
  });
});

describe("reading the sheet", () => {
  beforeEach(async () => {
    await signIn(manager.id, "CENTRE_MANAGER", centre.id);
  });

  it("understands the job titles a club actually types", async () => {
    const csv = [
      "name,email,role",
      "Meena Rao,meena@club.in,Head Coach",
      "Imran Shaikh,imran@club.in,Syce",
      "Nina Das,nina@club.in,accounts",
    ].join("\n");
    const res = await call({ csv });
    expect(res.status).toBe(200);
    const roles = await prisma.staff.findMany({ select: { role: true }, orderBy: { role: "asc" } });
    expect(roles.map((r) => r.role).sort()).toEqual(["ACCOUNTANT", "GROOM", "HEAD_COACH"]);
  });

  it("reports an unknown job title instead of guessing at it", async () => {
    // Defaulting an unrecognised title to COACH would hand a stranger a
    // coach's access to children's records. Refusing the row is the only safe
    // reading of "I don't know what this is".
    const res = await call({
      csv: ["name,email,role", "Sam Roy,sam@club.in,Chief Vibes Officer"].join("\n"),
    });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(JSON.stringify(body.errors)).toMatch(/Chief Vibes Officer/);
    expect(await prisma.staff.count()).toBe(0);
  });

  it("will not mint an HQ account from a spreadsheet", async () => {
    // SUPER_ADMIN and ADMIN are not assignable staff roles. A sheet is the
    // last place a platform-wide administrator should come from.
    const res = await call({
      csv: ["name,email,role", "Sneaky,sneak@club.in,SUPER_ADMIN"].join("\n"),
    });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(await prisma.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
  });

  it("rejects a row with no email — that account could never sign in", async () => {
    const res = await call({ csv: ["name,email,role", "No Mail,,COACH"].join("\n") });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(JSON.stringify(body.errors)).toMatch(/email/i);
  });

  it("skips an email already in use rather than overwriting the person", async () => {
    const res = await call({
      csv: ["name,email,role", "Impostor,mgr@club.in,COACH"].join("\n"),
    });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(JSON.stringify(body.errors)).toMatch(/already in use/i);
    // The existing account is untouched — still the manager, not a coach.
    const existing = await prisma.user.findUniqueOrThrow({ where: { email: "mgr@club.in" } });
    expect(existing.role).toBe("CENTRE_MANAGER");
  });

  it("catches the same address twice INSIDE one sheet", async () => {
    // A club's spreadsheet repeats people. Claiming the address only at write
    // time lets both copies pass validation and the second dies on the unique
    // index, rolling back rows the operator was already told were fine.
    const res = await call({
      csv: [
        "name,email,role",
        "Ravi Kumar,ravi@club.in,COACH",
        "Ravi Kumar,ravi@club.in,COACH",
      ].join("\n"),
    });
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.errors.length).toBe(1);
  });

  it("matches an email case-insensitively, the way the login does", async () => {
    await call({ csv: ["name,email,role", "Ravi Kumar,ravi@club.in,COACH"].join("\n") });
    const res = await call({ csv: ["name,email,role", "Ravi Again,RAVI@Club.IN,COACH"].join("\n") });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(await prisma.user.count({ where: { email: "ravi@club.in" } })).toBe(1);
  });

  it("writes nothing on a dry run", async () => {
    const res = await call({ csv: CSV, dryRun: true });
    const body = await res.json();
    expect(body.wouldCreate).toBe(1);
    expect(await prisma.staff.count()).toBe(0);
    expect(await prisma.user.count({ where: { email: "ravi@club.in" } })).toBe(0);
  });
});

describe("the accounts it creates", () => {
  beforeEach(async () => {
    await signIn(manager.id, "CENTRE_MANAGER", centre.id);
  });

  it("creates a usable login and a staff record together", async () => {
    const res = await call({ csv: CSV });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ravi@club.in" } });
    expect(user.name).toBe("Ravi Kumar");
    expect(user.role).toBe("COACH");
    expect(user.status).toBe("active");
    // Admin-created, so the admin vouches for the address — otherwise a new
    // hire hits a verification wall for an address the club supplied itself.
    expect(user.emailVerifiedAt).not.toBeNull();

    const staff = await prisma.staff.findUniqueOrThrow({ where: { userId: user.id } });
    expect(staff.role).toBe("COACH");
    expect(staff.salaryBand).toBe("C2");
    expect(staff.joiningDate.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("generates each password and puts it on the Credential Sheet", async () => {
    // No password column exists, deliberately: a spreadsheet of plaintext
    // credentials gets emailed around and left in Downloads. The generated one
    // has to be retrievable, or nobody can hand the login over.
    await call({ csv: CSV });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ravi@club.in" } });

    const issued = revealIssuedCredential(user.issuedPasswordEnc);
    expect(issued).toBeTruthy();
    expect(issued!.length).toBeGreaterThanOrEqual(12);
    // The sheet's password is the one that actually signs this person in.
    expect(await verifyPassword(issued!, user.passwordHash!)).toBe(true);
    expect(user.issuedById).toBe(manager.id);
  });

  it("gives two people two different passwords", async () => {
    await call({
      csv: [
        "name,email,role",
        "Ravi Kumar,ravi@club.in,COACH",
        "Meena Rao,meena@club.in,COACH",
      ].join("\n"),
    });
    const users = await prisma.user.findMany({
      where: { email: { in: ["ravi@club.in", "meena@club.in"] } },
    });
    const secrets = users.map((u) => revealIssuedCredential(u.issuedPasswordEnc));
    expect(new Set(secrets).size).toBe(2);
  });

  it("leaves police verification empty — bulk upload is not a way past it", async () => {
    // Mandatory before anyone works with minors. A spreadsheet cannot carry a
    // certificate, so the field must stay conspicuously unset rather than
    // arriving looking satisfied.
    await call({ csv: CSV });
    const staff = await prisma.staff.findFirstOrThrow();
    expect(staff.policeVerificationUrl).toBeNull();
    expect(staff.policeVerifiedAt).toBeNull();
  });

  it("records the import in the audit log", async () => {
    await call({ csv: CSV });
    const entry = await prisma.auditLog.findFirst({ where: { action: "staff.import" } });
    expect(entry).not.toBeNull();
  });
});

describe("the template we hand out", () => {
  it("has exactly the headers the importer reads", async () => {
    // A template that drifts from the importer is worse than no template: the
    // club fills in a column nobody reads and finds out at upload time. This
    // is the drift guard — it fails the moment either side changes alone.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile("public/templates/equiwings-staff-import-template.xlsx");
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(1).values as unknown[])
      .slice(1)
      .map((v) => String(v ?? "").trim());

    expect(headers).toEqual([
      "name",
      "email",
      "role",
      "phone",
      "salary_band",
      "joining_date",
    ]);
  });

  it("carries no password column, and never should", async () => {
    // The single most important thing about this sheet. It travels by email
    // and lives in Downloads folders; a credential must not be in it.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile("public/templates/equiwings-staff-import-template.xlsx");
    const headers = String(wb.worksheets[0].getRow(1).values);
    expect(headers.toLowerCase()).not.toMatch(/password|passcode|pwd/);
  });

  it("is readable by our own parser, comments and all", async () => {
    // openpyxl once wrote cell comments in a form ExcelJS could not read, so
    // the file a club downloaded would not import. Read the shipped artefact.
    const fs = await import("node:fs/promises");
    const { parseXlsx } = await import("@/lib/xlsx-parse");
    const buf = await fs.readFile("public/templates/equiwings-staff-import-template.xlsx");
    const { rows } = await parseXlsx(buf);
    // Headers only — no example rows to import by accident.
    expect(rows).toHaveLength(0);
  });
});
