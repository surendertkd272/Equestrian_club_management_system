// Collecting indemnity + injury NOC after a bulk import.
//
// A spreadsheet cannot carry a signature, so imported riders arrive with no
// consent at all — and it shows on a profile as an empty field rather than an
// alarm. This is the loop that closes it: email a tokenised link, they sign,
// the club confirms.
//
// The tests concentrate on the token, because it is a bearer credential that
// sets legal consent on a named child.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";
import { hashToken, findLiveRequest, consentRecipient } from "@/lib/rider-consent-request";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { POST: sign } = await import("@/app/api/consent/[token]/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;

/** Create a request row directly, returning the RAW token. */
async function makeRequest(riderId: string, over: Record<string, unknown> = {}) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.riderConsentRequest.create({
    data: {
      riderId,
      centreId: centre.id,
      email: "parent@club.in",
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 30 * 86400_000),
      ...over,
    },
  });
  return raw;
}

const submit = (token: string, body: unknown) =>
  sign(
    mockReq(`http://localhost/api/consent/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "ParentPhone/1.0" },
      body: JSON.stringify(body),
    }),
    { params: { token } },
  );

const GOOD = { fullNameSignature: "Priya Sharma", agreed: true, injuryNocAgreed: true };

beforeEach(async () => {
  await resetDb();
  org = await mkOrg("Consent Req Club");
  centre = await mkCentre({ orgId: org.id, name: "CR Centre" });
});

describe("signing via the emailed link", () => {
  it("records a consent identical in shape to the registration form's", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const token = await makeRequest(rider.id);

    const res = await submit(token, { ...GOOD, signerRelation: "parent" });
    expect(res.status).toBe(200);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.indemnitySignedAt).not.toBeNull();
    expect(after.indemnitySignerUa).toContain("ParentPhone");
    // Versions pinned the same way, or the club ends up with two tiers of
    // consent and no way to tell them apart later.
    expect(after.indemnityVersion).toBeTruthy();

    const c = after.indemnityConsentJson as Record<string, unknown>;
    expect(c.signature).toBe("Priya Sharma");
    expect(c.nocAgreed).toBe(true);
    expect(c.signerRelation).toBe("parent");
    // Provenance: a signature collected this way must be distinguishable from
    // one taken at registration.
    expect(c.collectedVia).toBe("consent_request");
  });

  it("forces a fresh club-side check after signing", async () => {
    const rider = await mkRider({ centreId: centre.id });
    await prisma.rider.update({
      where: { id: rider.id },
      data: { verifiedAt: new Date(), verifiedByUserId: "someone" },
    });
    const token = await makeRequest(rider.id);
    await submit(token, GOOD);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    // An earlier verification was of the old paperwork, not this signature.
    // Carrying it over would mean a document nobody checked reads as checked.
    expect(after.verifiedAt).toBeNull();
  });

  it("burns the link — it cannot be reused", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const token = await makeRequest(rider.id);
    await submit(token, GOOD);

    const second = await submit(token, { ...GOOD, fullNameSignature: "Someone Else" });
    const body = await second.json();
    expect(body.alreadySigned).toBe(true);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    // The first signature stands; a replayed link must not overwrite who signed.
    expect((after.indemnityConsentJson as Record<string, unknown>).signature).toBe("Priya Sharma");
  });

  it("rejects an expired link without signing anything", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const token = await makeRequest(rider.id, {
      expiresAt: new Date(Date.now() - 86400_000),
    });
    expect((await submit(token, GOOD)).status).toBe(410);
    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.indemnitySignedAt).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect((await submit(crypto.randomBytes(32).toString("base64url"), GOOD)).status).toBe(404);
  });

  it("will not sign with a box unticked", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const token = await makeRequest(rider.id);
    // The NOC is a separate agreement; a form that accepted one and not the
    // other would produce a record claiming both.
    expect((await submit(token, { ...GOOD, injuryNocAgreed: false })).status).toBe(400);
    expect((await submit(token, { ...GOOD, fullNameSignature: "  " })).status).toBe(400);

    const after = await prisma.rider.findUniqueOrThrow({ where: { id: rider.id } });
    expect(after.indemnitySignedAt).toBeNull();
  });
});

describe("the token itself", () => {
  it("is stored hashed, never in the clear", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const raw = await makeRequest(rider.id);
    const row = await prisma.riderConsentRequest.findFirstOrThrow({ where: { riderId: rider.id } });
    // These links are bearer credentials for a child's legal consent. A dump
    // of this table must not be a working set of them.
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("resolves only via the raw token", async () => {
    const rider = await mkRider({ centreId: centre.id });
    const raw = await makeRequest(rider.id);
    expect(await findLiveRequest(raw)).not.toBeNull();
    expect(await findLiveRequest("not-a-real-token-but-long-enough-x")).toBeNull();
  });
});

describe("who gets the email", () => {
  it("prefers the rider, falls back to a linked parent", () => {
    expect(consentRecipient({ email: "rider@club.in" })).toBe("rider@club.in");
    // A minor usually has no address of their own, and the parent is the one
    // who must sign anyway.
    expect(
      consentRecipient({ email: null, parentLinks: [{ parent: { email: "mum@club.in" } }] }),
    ).toBe("mum@club.in");
    expect(consentRecipient({ email: "  ", parentLinks: [] })).toBeNull();
  });
});
