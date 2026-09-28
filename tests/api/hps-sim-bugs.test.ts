// Bugs from the 500-rider HPS Hyderabad simulation (2026-09-29):
//   1. A mobile starting "91" was cut to 8 digits by indianMobile().
//   2. Centre.managerId was never set for an app-created centre, so every
//      centre-manager notification there went nowhere.
//   3. "Send result to parent" only used rider.email — a child with parents
//      linked but no address of their own showed "No email on file".
//   4. <Badge> rendered a <div>, invalid inside <p> → hydration error on the
//      parent's child page (and anywhere else a badge sits in a sentence).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser, mkRider, linkParent } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { indianMobile, stripCountryCode } from "@/lib/schemas/phone";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));
const sent: string[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (o: { to: string }) => {
    sent.push(o.to);
    return { ok: true };
  },
}));

const { POST: createUser } = await import("@/app/api/users/route");
const { PATCH: patchCentre } = await import("@/app/api/centres/[id]/route");
const { POST: emailResult } = await import("@/app/api/certificates/[id]/email-result/route");

type U = { id: string; role: string; centreId: string | null; name: string };
async function login(u: U) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

describe("mobile numbers starting 91 are kept whole (bug 1)", () => {
  const parse = (s: string) => indianMobile().parse(s);
  it("keeps a bare 10-digit 91xxxxxxxx mobile", () => {
    expect(parse("9100014662")).toBe("9100014662");
    expect(parse("91000 14662")).toBe("9100014662");
  });
  it("still strips a real country code or trunk 0", () => {
    expect(parse("+91 91000 14662")).toBe("9100014662");
    expect(parse("919100014662")).toBe("9100014662");
    expect(parse("09811045566")).toBe("9811045566");
    expect(parse("+91-98110-45566")).toBe("9811045566");
  });
  it("the import normaliser agrees", () => {
    expect(stripCountryCode("9100014662")).toBe("9100014662");
    expect(stripCountryCode("+919100014662")).toBe("9100014662");
  });
});

describe("a centre gets its manager linked (bug 2)", () => {
  it("creating the first centre manager links them; a second doesn't take over", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "ADMIN", orgId: org.id, name: "Admin" });
    await login(admin);
    const first = await createUser(
      mockReq("http://localhost/api/users", json({ name: "First Manager", email: "first@hps.test", role: "CENTRE_MANAGER", centreId: centre.id })),
    );
    expect(first.status).toBeLessThan(300);
    const firstId = (await prisma.user.findUnique({ where: { email: "first@hps.test" } }))!.id;
    expect((await prisma.centre.findUnique({ where: { id: centre.id } }))!.managerId).toBe(firstId);

    await createUser(
      mockReq("http://localhost/api/users", json({ name: "Second Manager", email: "second@hps.test", role: "CENTRE_MANAGER", centreId: centre.id })),
    );
    expect((await prisma.centre.findUnique({ where: { id: centre.id } }))!.managerId).toBe(firstId);
  });

  it("HQ can change the manager, but only to an active centre manager of that centre", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const other = await mkCentre({ orgId: org.id });
    const admin = await mkUser({ role: "ADMIN", orgId: org.id, name: "Admin" });
    const mine = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const elsewhere = await mkUser({ role: "CENTRE_MANAGER", centreId: other.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const gone = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, status: "inactive" });
    await login(admin);
    const patch = (managerId: string | null) =>
      patchCentre(mockReq(`http://localhost/api/centres/${centre.id}`, json({ managerId }, "PATCH")), { params: { id: centre.id } });

    for (const bad of [elsewhere.id, coach.id, gone.id, "nope"]) {
      const r = await patch(bad);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("INVALID_MANAGER");
    }
    expect((await patch(mine.id)).status).toBe(200);
    expect((await prisma.centre.findUnique({ where: { id: centre.id } }))!.managerId).toBe(mine.id);
    expect((await patch(null)).status).toBe(200);
    expect((await prisma.centre.findUnique({ where: { id: centre.id } }))!.managerId).toBeNull();
  });
});

describe("the exam result goes to the parents (bug 3)", () => {
  async function passedCert(riderEmail: string | null) {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const rider = await mkRider({ centreId: centre.id, email: riderEmail });
    const examiner = await mkUser({ role: "EXAMINER", centreId: centre.id, name: "Judge" });
    const exam = await prisma.exam.create({
      data: {
        centreId: centre.id, riderId: rider.id, examinerId: examiner.id, examinerName: "Judge", level: 1,
        date: new Date("2026-10-01T00:00:00Z"), status: "completed", scoresJson: {}, totalScore: 80, passed: true,
      },
    });
    const cert = await prisma.certificate.create({
      data: { centreId: centre.id, riderId: rider.id, examId: exam.id, type: "promotion", levelName: "Level 1", serialNo: `S-${exam.id}`, qrCode: "qr" },
    });
    const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Mgr" });
    return { centre, rider, cert, manager };
  }
  const send = (id: string) => emailResult(mockReq(`http://localhost/x/${id}`, { method: "POST" }), { params: { id } });

  it("sends to every linked parent when the child has no email of their own", async () => {
    const w = await passedCert(null);
    const dad = await mkUser({ role: "PARENT", email: "dad@family.test" });
    const mum = await mkUser({ role: "PARENT", email: "mum@family.test" });
    await linkParent({ parentUserId: dad.id, riderId: w.rider.id });
    await linkParent({ parentUserId: mum.id, riderId: w.rider.id, relationship: "mother" });
    await login(w.manager);
    const r = await send(w.cert.id);
    expect(r.status).toBe(200);
    expect(sent.sort()).toEqual(["dad@family.test", "mum@family.test"]);
  });

  it("falls back to the registration form's parent email, then the rider's own", async () => {
    const w = await passedCert(null);
    await prisma.rider.update({ where: { id: w.rider.id }, data: { parentalConsentJson: { parentEmail: "guardian@family.test" } } });
    await login(w.manager);
    expect((await send(w.cert.id)).status).toBe(200);
    expect(sent).toEqual(["guardian@family.test"]);

    const adult = await passedCert("adult.rider@test.local");
    sent.length = 0;
    await login(adult.manager);
    expect((await send(adult.cert.id)).status).toBe(200);
    expect(sent).toEqual(["adult.rider@test.local"]);
  });

  it("still refuses when nobody can be reached", async () => {
    const w = await passedCert(null);
    await login(w.manager);
    const r = await send(w.cert.id);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("NO_PARENT_EMAIL");
  });
});

describe("a badge can sit inside a paragraph (bug 4)", () => {
  // Vitest here doesn't compile .tsx, so check the component's markup at source.
  it("renders an inline <span>, never a block <div>", () => {
    const src = readFileSync("components/ui/badge.tsx", "utf8");
    const body = src.slice(src.indexOf("export function Badge"));
    expect(body).toMatch(/<span className=\{cn\(badgeVariants/);
    expect(body).not.toMatch(/<div/);
  });
});
