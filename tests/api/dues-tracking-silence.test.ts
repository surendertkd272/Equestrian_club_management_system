// Internal dues tracking: the club knows what a rider owes, the family never
// does.
//
// The client's requirement was explicit — "parents and riders should not get
// any notification or msg of it, they should not know". A mode that mostly
// keeps quiet is worthless: one forgotten channel and a family gets a bill
// from a club that promised never to send one.
//
// So the rule lives in one place (lib/money-contact.ts) and these assert the
// two halves separately: the due EXISTS, and nobody is told.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { canContactAboutMoney, tracksDues } from "@/lib/money-contact";

// Capture every outbound channel.
const sent: { channel: string; to: string }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  sendEmail: vi.fn(async (o: { to: string }) => { sent.push({ channel: "email", to: o.to }); return { ok: true as const }; }),
}));
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  sendSms: vi.fn(async (o: { to: string }) => { sent.push({ channel: "sms", to: o.to }); return { ok: true as const }; }),
}));
vi.mock("@/lib/whatsapp", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  sendWhatsApp: vi.fn(async (o: { to: string }) => { sent.push({ channel: "whatsapp", to: o.to }); return { ok: true as const }; }),
}));

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { PATCH } = await import("@/app/api/enrolments/[id]/route");
const { signSession } = await import("@/lib/auth");
const { mockReq } = await import("../helpers/request");

async function setFlags(orgId: string, dues: boolean, billing: boolean) {
  await prisma.orgFeature.updateMany({
    where: { orgId, featureKey: "dues-tracking" }, data: { enabled: dues },
  });
  await prisma.orgFeature.updateMany({
    where: { orgId, featureKey: "fee-collection" }, data: { enabled: billing },
  });
}

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  org = await mkOrg("Quiet Club");
  centre = await mkCentre({ orgId: org.id, name: "Quiet Centre" });
});

describe("the two questions are separate", () => {
  it("tracks dues without permission to contact anyone", async () => {
    await setFlags(org.id, true, false);
    expect(await tracksDues(org.id)).toBe(true);
    // The entire promise of the mode, in one assertion.
    expect(await canContactAboutMoney(org.id)).toBe(false);
  });

  it("a club that bills is obviously tracking dues too", async () => {
    // Legacy customers have never set the new flag; keying only on it would
    // silently strip the ledger from every existing billing club.
    await setFlags(org.id, false, true);
    expect(await tracksDues(org.id)).toBe(true);
    expect(await canContactAboutMoney(org.id)).toBe(true);
  });

  it("neither flag means neither thing", async () => {
    await setFlags(org.id, false, false);
    expect(await tracksDues(org.id)).toBe(false);
    expect(await canContactAboutMoney(org.id)).toBe(false);
  });

  it("fails closed on an unknown club", async () => {
    // A missing org must never be read as permission to message someone.
    expect(await canContactAboutMoney(null)).toBe(false);
    expect(await tracksDues(undefined)).toBe(false);
  });
});

describe("approving a rider in internal-dues mode", () => {
  async function approve(riderId: string, hqId: string) {
    cookieJar.clear();
    cookieJar.set("ew_session", {
      value: await signSession({
        userId: hqId, role: "SUPER_ADMIN" as never, centreId: null,
        orgId: org.id, tokenVersion: 0, name: "T",
      } as never),
    });
    return PATCH(
      mockReq(`http://localhost/api/enrolments/${riderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: { id: riderId } },
    );
  }

  it("raises the due and tells NOBODY", async () => {
    await setFlags(org.id, true, false);
    const hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@q.in" });
    const r = await mkRider({ centreId: centre.id, email: "parent@q.in" });
    await prisma.rider.update({
      where: { id: r.id },
      data: { status: "pending_approval", selfEnrolled: true, verifiedAt: new Date() },
    });

    const res = await approve(r.id, hq.id);
    expect(res.status).toBe(200);
    expect((await res.json()).notified).toBe(false);

    // The club's books know.
    const inv = await prisma.invoice.findFirst({ where: { riderId: r.id } });
    expect(inv).not.toBeNull();

    // The family does not. No email, no SMS, no WhatsApp — the requirement
    // was "they should not know", and a payment link is knowing.
    expect(sent).toHaveLength(0);
  });
});
