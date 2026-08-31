// Riders imported from a spreadsheet are held until consent exists.
//
// A sheet cannot carry a signature, so an imported rider previously arrived
// "active" — on a coach's register, markable present, with no indemnity and no
// injury NOC on file. These assert the hold, and just as importantly that it
// releases on its own.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { hashToken } from "@/lib/rider-consent-request";
import { ENROLLED_RIDER_STATUSES, RIDER_STATUS, riderBlockedReason } from "@/lib/rider-status";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { POST: sign } = await import("@/app/api/consent/[token]/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;

async function heldRider() {
  const r = await mkRider({ centreId: centre.id });
  return prisma.rider.update({
    where: { id: r.id },
    data: { status: RIDER_STATUS.PENDING_CONSENT, indemnitySignedAt: null },
  });
}

async function linkFor(riderId: string) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.riderConsentRequest.create({
    data: {
      riderId,
      centreId: centre.id,
      email: "parent@gate.in",
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    },
  });
  return raw;
}

const GOOD = { fullNameSignature: "Priya Sharma", agreed: true, injuryNocAgreed: true };

beforeEach(async () => {
  await resetDb();
  org = await mkOrg("Gate Club");
  centre = await mkCentre({ orgId: org.id, name: "Gate Centre" });
});

describe("the hold", () => {
  it("keeps an unsigned rider off every coach-facing surface", () => {
    // The whole gate is this omission: every register and rider-picker filters
    // on ENROLLED_RIDER_STATUSES, so one list controls them all rather than
    // each page needing a check somebody could forget.
    expect(ENROLLED_RIDER_STATUSES).not.toContain(RIDER_STATUS.PENDING_CONSENT);
    expect(ENROLLED_RIDER_STATUSES).toContain("active");
  });

  it("explains itself to a human", () => {
    expect(riderBlockedReason(RIDER_STATUS.PENDING_CONSENT)).toMatch(/indemnity|NOC/i);
    // An ordinary rider is not "blocked" and must not be labelled as such.
    expect(riderBlockedReason("active")).toBeNull();
  });
});

describe("the release", () => {
  it("activates the rider the moment consent is signed", async () => {
    const rider = await heldRider();
    const token = await linkFor(rider.id);

    const res = await sign(
      mockReq(`http://localhost/api/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(GOOD),
      }),
      { params: { token } },
    );
    expect(res.status).toBe(200);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    // Automatic on purpose. The reason for the hold disappears when the parent
    // signs, and waiting for an administrator as well would leave a signed-up
    // child at the gate on a Saturday because nobody was at a desk.
    expect(after.status).toBe(RIDER_STATUS.ACTIVE);
    expect(after.indemnitySignedAt).not.toBeNull();
  });

  it("still requires a staff check afterwards, without blocking riding", async () => {
    const rider = await heldRider();
    const token = await linkFor(rider.id);
    await sign(
      mockReq(`http://localhost/api/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(GOOD),
      }),
      { params: { token } },
    );
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    // Confirmation is the audit of the document, not the permission to ride.
    expect(after.verifiedAt).toBeNull();
    expect(after.status).toBe(RIDER_STATUS.ACTIVE);
  });

  it("does not disturb a rider who was already active", async () => {
    // The existing roster all signed at registration. Signing again — a
    // re-issued link, say — must not move anyone's status around.
    const rider = await mkRider({ centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { status: "pending_payment" } });
    const token = await linkFor(rider.id);
    await sign(
      mockReq(`http://localhost/api/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(GOOD),
      }),
      { params: { token } },
    );
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.status).toBe("pending_payment");
  });
});
