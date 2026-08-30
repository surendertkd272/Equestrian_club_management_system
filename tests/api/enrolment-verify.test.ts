// Document verification before enrolment approval.
//
// Approving used to be one click off a summary row: a name, a phone number, a
// school. Nobody had to open the Aadhaar scan they were vouching for, so
// "approved" recorded that a button was pressed. These assert that the check
// is now a real gate rather than a decorative one — the failure mode for this
// kind of feature is a button that looks like a control and isn't.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { signSession } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { PATCH } = await import("@/app/api/enrolments/[id]/route");

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id,
      role: u.role as never,
      centreId: u.centreId,
      orgId: u.orgId ?? null,
      tokenVersion: 0,
      name: "T",
    } as never),
  });
}

const call = (id: string, body: unknown) =>
  PATCH(
    mockReq(`http://localhost/api/enrolments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

async function pendingRider() {
  const r = await mkRider({ centreId: centre.id });
  return prisma.rider.update({
    where: { id: r.id },
    data: { status: "pending_approval", selfEnrolled: true },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Verify Club");
  centre = await mkCentre({ orgId: org.id, name: "Verify Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@v.in" });
});

describe("verification gates approval", () => {
  it("refuses to approve an unverified enrolment", async () => {
    const rider = await pendingRider();
    await signIn(hq);

    const res = await call(rider.id, { action: "approve" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "NOT_VERIFIED" });

    // Still pending — the refusal must not half-apply.
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.status).toBe("pending_approval");
    expect(after.approvedAt).toBeNull();
  });

  it("allows approval once verified", async () => {
    const rider = await pendingRider();
    await signIn(hq);

    expect((await call(rider.id, { action: "verify" })).status).toBe(200);
    const res = await call(rider.id, { action: "approve" });
    expect(res.status).toBe(200);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.status).not.toBe("pending_approval");
    expect(after.approvedAt).not.toBeNull();
  });

  it("records who verified, when, and any note", async () => {
    const rider = await pendingRider();
    await signIn(hq);
    await call(rider.id, { action: "verify", note: "Aadhaar spelling differs, confirmed by phone" });

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    // A check with nobody's name against it is not worth recording.
    expect(after.verifiedByUserId).toBe(hq.id);
    expect(after.verifiedAt).not.toBeNull();
    expect(after.verifyNote).toContain("confirmed by phone");

    const log = await prisma.auditLog.findFirst({ where: { action: "enrolment.verify" } });
    expect(log?.userId).toBe(hq.id);
  });

  it("lets a second look withdraw the verification", async () => {
    const rider = await pendingRider();
    await signIn(hq);
    await call(rider.id, { action: "verify" });
    expect((await call(rider.id, { action: "unverify" })).status).toBe(200);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.verifiedAt).toBeNull();
    expect(after.verifiedByUserId).toBeNull();
    // ...and approval is barred again.
    expect((await call(rider.id, { action: "approve" })).status).toBe(409);
  });

  it("still allows rejection without verification", async () => {
    // You should not have to vouch for someone's documents in order to turn
    // them away — often the missing documents ARE the reason.
    const rider = await pendingRider();
    await signIn(hq);
    const res = await call(rider.id, { action: "reject" });
    expect(res.status).toBe(200);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.status).toBe("rejected");
  });
});

describe("who may verify", () => {
  it("allows the centre manager", async () => {
    const rider = await pendingRider();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@v.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await call(rider.id, { action: "verify" })).status).toBe(200);
  });

  it("refuses the read-only partner school account", async () => {
    // SCHOOL_ADMINISTRATOR sees this queue but is a read-only oversight
    // account. Vouching for a rider's Aadhaar is not a read.
    const rider = await pendingRider();
    const sa = await mkUser({ role: "SCHOOL_ADMINISTRATOR", centreId: centre.id, email: "sa@v.in" });
    await signIn({ id: sa.id, role: "SCHOOL_ADMINISTRATOR", centreId: centre.id, orgId: org.id });
    expect((await call(rider.id, { action: "verify" })).status).toBe(403);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.verifiedAt).toBeNull();
  });

  it("refuses a coach outright", async () => {
    const rider = await pendingRider();
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@v.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await call(rider.id, { action: "verify" })).status).toBe(403);
  });

  it("cannot verify a rider at another club", async () => {
    const other = await mkOrg("Rival");
    const otherCentre = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const r = await mkRider({ centreId: otherCentre.id });
    await prisma.rider.update({
      where: { id: r.id },
      data: { status: "pending_approval", selfEnrolled: true },
    });
    await signIn(hq);

    expect((await call(r.id, { action: "verify" })).status).toBe(403);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.verifiedAt).toBeNull();
  });
});
