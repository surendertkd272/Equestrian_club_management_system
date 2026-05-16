import { describe, it, expect, beforeEach } from "vitest";
import { notify, notifyMany, notifyRole, notifyCentreManager } from "./notify";
import { prisma } from "./prisma";
import { resetDb } from "../tests/helpers/db";

beforeEach(async () => {
  await resetDb();
});

async function mkUser(over: { email?: string; role?: string; centreId?: string | null; status?: string } = {}) {
  return prisma.user.create({
    data: {
      email: over.email ?? `u-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: "x",
      name: "Test User",
      role: over.role ?? "COACH",
      centreId: over.centreId ?? null,
      status: over.status ?? "active",
    },
  });
}

async function mkCentre(over: { name?: string; slug?: string; managerId?: string | null } = {}) {
  const org = await prisma.organisation.create({ data: { name: "Test Org", slug: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } });
  return prisma.centre.create({
    data: {
      orgId: org.id,
      name: over.name ?? "Test Centre",
      slug: over.slug ?? `test-${Math.random().toString(36).slice(2)}`,
      managerId: over.managerId ?? null,
    },
  });
}

describe("notify", () => {
  it("writes a notification row with defaults filled in", async () => {
    const u = await mkUser();
    const n = await notify({ userId: u.id, type: "test.basic", title: "T", body: "B" });
    expect(n).not.toBeNull();
    expect(n!.channel).toBe("in_app");
    expect(n!.link).toBeNull();
    expect(n!.payload).toBeNull();
    expect(n!.centreId).toBeNull();
    expect(n!.readAt).toBeNull();

    const count = await prisma.notification.count();
    expect(count).toBe(1);
  });

  it("stringifies payload as JSON", async () => {
    const u = await mkUser();
    const n = await notify({
      userId: u.id,
      type: "test.payload",
      title: "T",
      body: "B",
      payload: { invoiceId: "inv_1", amount: 3000 },
    });
    expect(n!.payload).toBe(JSON.stringify({ invoiceId: "inv_1", amount: 3000 }));
  });

  it("honours an explicit channel", async () => {
    const u = await mkUser();
    const n = await notify({ userId: u.id, type: "t", title: "T", body: "B", channel: "sms" });
    expect(n!.channel).toBe("sms");
  });

  it("returns null (does not throw) on FK violation", async () => {
    // userId references a non-existent user → Prisma rejects → notify swallows.
    const res = await notify({ userId: "missing", type: "t", title: "T", body: "B" });
    expect(res).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("notifyMany", () => {
  it("creates one row per unique recipient", async () => {
    const [a, b] = await Promise.all([mkUser(), mkUser()]);
    await notifyMany([a.id, b.id, a.id], { type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(2);
  });

  it("filters out empty / falsy ids before fanning out", async () => {
    const u = await mkUser();
    await notifyMany([u.id, "", u.id], { type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(1);
  });

  it("partial failure still delivers to others", async () => {
    const u = await mkUser();
    await notifyMany([u.id, "missing-user"], { type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(1);
  });
});

describe("notifyRole", () => {
  it("delivers to all active users with the given role in the centre", async () => {
    const centre = await mkCentre();
    const otherCentre = await mkCentre({ slug: "other" });

    const examiners = await Promise.all([
      mkUser({ role: "EXAMINER", centreId: centre.id }),
      mkUser({ role: "EXAMINER", centreId: centre.id }),
    ]);
    await mkUser({ role: "COACH", centreId: centre.id }); // wrong role
    await mkUser({ role: "EXAMINER", centreId: otherCentre.id }); // wrong centre
    await mkUser({ role: "EXAMINER", centreId: centre.id, status: "suspended" }); // suspended

    await notifyRole("EXAMINER", { centreId: centre.id, type: "t", title: "T", body: "B" });

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set(examiners.map((u) => u.id)));
  });

  it("no-ops cleanly when no users match", async () => {
    const centre = await mkCentre();
    await notifyRole("VET", { centreId: centre.id, type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("notifyCentreManager", () => {
  it("delivers to centre.managerId when set", async () => {
    const mgr = await mkUser({ role: "CENTRE_MANAGER" });
    const centre = await mkCentre({ managerId: mgr.id });

    await notifyCentreManager(centre.id, { type: "t", title: "T", body: "B", link: "/x" });

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(mgr.id);
    expect(rows[0].centreId).toBe(centre.id);
    expect(rows[0].link).toBe("/x");
  });

  it("silently no-ops when the centre has no manager", async () => {
    const centre = await mkCentre({ managerId: null });
    await notifyCentreManager(centre.id, { type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(0);
  });

  it("silently no-ops when the centre id is unknown", async () => {
    await notifyCentreManager("not-a-centre", { type: "t", title: "T", body: "B" });
    expect(await prisma.notification.count()).toBe(0);
  });
});
