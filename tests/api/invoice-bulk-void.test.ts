// Voiding a batch of invoices that should never have existed.
//
// The case: a club had fee-collection on when it should not have been, so
// every approved rider was issued a registration invoice — 97 of them, none
// paid, all sitting in the books as money nobody intends to collect.
//
// Writing off money in bulk is the kind of operation where the REFUSALS are
// the feature, so that is most of what these assert.

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

const { POST: bulkVoid } = await import("@/app/api/invoices/bulk-void/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id, role: u.role as never, centreId: u.centreId,
      orgId: u.orgId ?? null, tokenVersion: 0, name: "T",
    } as never),
  });
}

const call = (body: unknown) =>
  bulkVoid(mockReq("http://localhost/api/invoices/bulk-void", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

async function invoiceFor(centreId: string, over: Record<string, unknown> = {}) {
  const rider = await mkRider({ centreId });
  return prisma.invoice.create({
    data: {
      centreId, riderId: rider.id, amount: 3000, status: "due",
      kind: "registration", dueDate: new Date(),
      ...over,
    },
  });
}

const REASON = "Raised while fee-collection was enabled in error.";

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Void Club");
  centre = await mkCentre({ orgId: org.id, name: "Void Centre" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@v.in" });
});

describe("bulk void", () => {
  it("voids unpaid invoices and records who, when and why", async () => {
    await invoiceFor(centre.id);
    await invoiceFor(centre.id);
    await signIn(hq);

    const body = await (await call({ centreId: centre.id, reason: REASON })).json();
    expect(body.count).toBe(2);
    expect(body.total).toBe(6000);

    const rows = await prisma.invoice.findMany();
    expect(rows.every((r) => r.status === "void")).toBe(true);
    // Soft, not deleted — an issued invoice number cannot vanish from a ledger.
    expect(rows.every((r) => r.voidedAt !== null)).toBe(true);
    expect(rows.every((r) => r.voidedByUserId === hq.id)).toBe(true);
    expect(rows[0].voidReason).toBe(REASON);

    const log = await prisma.auditLog.findFirst({ where: { action: "invoice.bulk_void" } });
    expect(log?.userId).toBe(hq.id);
  });

  it("NEVER touches an invoice a family has paid", async () => {
    const paid = await invoiceFor(centre.id);
    await prisma.payment.create({
      data: { invoiceId: paid.id, amount: 3000, method: "cash", paidAt: new Date() },
    });
    await invoiceFor(centre.id); // unpaid, should go
    await signIn(hq);

    const body = await (await call({ centreId: centre.id, reason: REASON })).json();
    expect(body.count).toBe(1);

    // Erasing a paid invoice would leave the family's money pointing at
    // nothing. That case needs a credit note, not a void.
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } });
    expect(after.status).toBe("due");
    expect(after.voidedAt).toBeNull();
  });

  it("dryRun reports the damage without doing it", async () => {
    await invoiceFor(centre.id);
    await signIn(hq);
    const body = await (await call({ centreId: centre.id, reason: REASON, dryRun: true })).json();
    expect(body.count).toBe(1);
    expect(body.total).toBe(3000);
    expect(await prisma.invoice.count({ where: { status: "void" } })).toBe(0);
  });

  it("cannot reach another tenant's ledger", async () => {
    const other = await mkOrg("Rival Void");
    const oc = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    const victim = await invoiceFor(oc.id);
    await signIn(hq);

    await call({ centreId: oc.id, reason: REASON });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.status).toBe("due");
  });

  it("pins a centre-tier caller to their own centre", async () => {
    const other = await mkCentre({ orgId: org.id, name: "Other Centre" });
    const elsewhere = await invoiceFor(other.id);
    await invoiceFor(centre.id);
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@v.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });

    // Asks for the other centre; gets their own regardless.
    const body = await (await call({ centreId: other.id, reason: REASON })).json();
    expect(body.count).toBe(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: elsewhere.id } })).status).toBe("due");
  });

  it("requires a reason", async () => {
    await invoiceFor(centre.id);
    await signIn(hq);
    expect((await call({ centreId: centre.id, reason: "" })).status).toBe(400);
    expect(await prisma.invoice.count({ where: { status: "void" } })).toBe(0);
  });

  it("refuses a coach", async () => {
    const coach = await mkUser({ role: "COACH", centreId: centre.id, email: "c@v.in" });
    await signIn({ id: coach.id, role: "COACH", centreId: centre.id, orgId: org.id });
    expect((await call({ centreId: centre.id, reason: REASON })).status).toBe(403);
  });

  it("is not blocked when fee-collection is off", async () => {
    // The catch-22 this fixes: switching the feature off is exactly when the
    // invoices it wrongly raised need cleaning up.
    await prisma.orgFeature.updateMany({
      where: { orgId: org.id, featureKey: "fee-collection" },
      data: { enabled: false },
    });
    await invoiceFor(centre.id);
    await signIn(hq);
    const res = await call({ centreId: centre.id, reason: REASON });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
});
