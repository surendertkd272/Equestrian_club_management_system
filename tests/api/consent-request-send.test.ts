// Issuing and sending the consent requests after a bulk upload.
//
// The signing half was tested; this half was not, and it is the half that
// decides whether ninety parents get an email or nothing happens quietly. The
// interesting behaviour is all in what it REFUSES to send: re-asking someone
// who already signed, or who already has a live link, is how a club teaches
// its parents that these emails are noise.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";

// Capture outbound mail instead of sending it.
const sent: { to: string; subject: string; html: string }[] = [];
vi.mock("@/lib/email", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    sendEmail: vi.fn(async (opts: { to: string; subject: string; html: string }) => {
      sent.push(opts);
      return { ok: true as const };
    }),
  };
});

const { issueConsentRequests } = await import("@/lib/rider-consent-request");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;

const issue = (riderIds: string[]) =>
  issueConsentRequests({
    riderIds,
    centreId: centre.id,
    centreName: centre.name,
    createdById: null,
  });

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://cms.example.in";
  org = await mkOrg("Send Club");
  centre = await mkCentre({ orgId: org.id, name: "Send Centre" });
});

describe("sending consent requests", () => {
  it("emails a signing link with an ABSOLUTE url", async () => {
    const rider = await mkRider({ centreId: centre.id, email: "parent@club.in" });
    const res = await issue([rider.id]);

    expect(res.requested).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("parent@club.in");
    // A relative link is dead on arrival in an inbox — this is the exact bug
    // that shipped once already on the shareable registration links.
    expect(sent[0].html).toContain("https://cms.example.in/consent/");
    expect(sent[0].html).not.toMatch(/href="\/consent\//);
  });

  it("stores the token hashed, never the link it emailed", async () => {
    const rider = await mkRider({ centreId: centre.id, email: "p2@club.in" });
    await issue([rider.id]);

    const row = await prisma.riderConsentRequest.findFirstOrThrow({ where: { riderId: rider.id } });
    const token = sent[0].html.match(/\/consent\/([A-Za-z0-9_-]+)/)![1];
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("does not re-ask someone who already signed", async () => {
    const rider = await mkRider({ centreId: centre.id, email: "signed@club.in" });
    await prisma.rider.update({
      where: { id: rider.id },
      data: { indemnitySignedAt: new Date() },
    });

    const res = await issue([rider.id]);
    expect(res.requested).toBe(0);
    expect(res.skippedAlreadySigned).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("does not send a second link while one is still live", async () => {
    const rider = await mkRider({ centreId: centre.id, email: "dup@club.in" });
    await issue([rider.id]);
    const second = await issue([rider.id]);

    // Two live links for one rider means the parent picks the wrong one and
    // it fails for no visible reason.
    expect(second.requested).toBe(0);
    expect(second.skippedAlreadyPending).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("names riders it cannot reach instead of failing silently", async () => {
    const noEmail = await mkRider({ centreId: centre.id, email: null, firstName: "Unreachable" });
    const res = await issue([noEmail.id]);

    // These are the paper-form cases. A count of "0 sent" with no names
    // attached would leave a club with no idea who still needs chasing.
    expect(res.requested).toBe(0);
    expect(res.skippedNoEmail).toHaveLength(1);
    expect(res.skippedNoEmail[0].name).toContain("Unreachable");
  });

  it("falls back to a linked parent's address", async () => {
    const rider = await mkRider({ centreId: centre.id, email: null });
    // A parent is a User with role PARENT — and, like every parent account,
    // carries centreId: null.
    const parent = await mkUser({ role: "PARENT", centreId: null, orgId: org.id, email: "mum@club.in" });
    await prisma.parentLink.create({
      data: { riderId: rider.id, parentUserId: parent.id, relationship: "mother" },
    });

    const res = await issue([rider.id]);
    // A minor usually has no address of their own, and the parent is the one
    // who must sign anyway.
    expect(res.requested).toBe(1);
    expect(sent[0].to).toBe("mum@club.in");
  });

  it("cannot be pointed at a rider from another club", async () => {
    const other = await mkOrg("Rival Send");
    const otherCentre = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await mkRider({ centreId: otherCentre.id, email: "v@rival.in" });

    const res = await issue([victim.id]);
    // The centre filter is on the query, not on the caller remembering to
    // filter — an id from another club resolves to nothing.
    expect(res.requested).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await prisma.riderConsentRequest.count()).toBe(0);
  });

  it("handles a whole roster in one call", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await mkRider({ centreId: centre.id, email: `r${i}@club.in` });
      ids.push(r.id);
    }
    const res = await issue(ids);
    expect(res.requested).toBe(25);
    expect(sent).toHaveLength(25);
    // Each link must be unique, or one signature would sign for everyone.
    const tokens = sent.map((s) => s.html.match(/\/consent\/([A-Za-z0-9_-]+)/)![1]);
    expect(new Set(tokens).size).toBe(25);
  });
});
