import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkRider, mkUser, linkParent } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  notifyParentsOfRider,
  notifyRiderAndParents,
} from "@/lib/notify";

// notify() depends on prisma only — no next/headers mock needed.
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

beforeEach(async () => {
  await resetDb();
});

describe("notifyParentsOfRider", () => {
  it("writes a Notification row for each linked parent", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const dad = await mkUser({ role: "PARENT", email: "dad@p.test" });
    const mum = await mkUser({ role: "PARENT", email: "mum@p.test" });
    await linkParent({ parentUserId: dad.id, riderId: rider.id, relationship: "father" });
    await linkParent({ parentUserId: mum.id, riderId: rider.id, relationship: "mother" });

    await notifyParentsOfRider(rider.id, {
      centreId: centre.id,
      type: "exam.passed",
      title: "Riya passed Level 1",
      body: "Score 88 / 100",
    });

    const dadInbox = await prisma.notification.findMany({ where: { userId: dad.id } });
    const mumInbox = await prisma.notification.findMany({ where: { userId: mum.id } });
    expect(dadInbox).toHaveLength(1);
    expect(mumInbox).toHaveLength(1);
    expect(dadInbox[0].title).toBe("Riya passed Level 1");
  });

  it("silently skips when rider has no linked parents", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });

    // Should not throw.
    await notifyParentsOfRider(rider.id, {
      type: "exam.passed",
      title: "n/a",
      body: "n/a",
    });

    const inbox = await prisma.notification.findMany();
    expect(inbox).toHaveLength(0);
  });
});

describe("notifyRiderAndParents", () => {
  it("notifies the rider's user account AND every linked parent", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const ridersAccount = await mkUser({ role: "RIDER", centreId: centre.id, email: "kid@x.test" });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: ridersAccount.id } });

    const dad = await mkUser({ role: "PARENT", email: "dad@x.test" });
    await linkParent({ parentUserId: dad.id, riderId: rider.id });

    await notifyRiderAndParents(rider.id, {
      centreId: centre.id,
      type: "exam.passed",
      title: "🎉 Level 1",
      body: "well done",
    });

    const rows = await prisma.notification.findMany({});
    expect(rows.map((r) => r.userId).sort()).toEqual([ridersAccount.id, dad.id].sort());
  });

  it("notifies just the rider when no parents are linked", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const ridersAccount = await mkUser({ role: "RIDER", centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: ridersAccount.id } });

    await notifyRiderAndParents(rider.id, {
      centreId: centre.id,
      type: "exam.passed",
      title: "x",
      body: "x",
    });
    const rows = await prisma.notification.findMany();
    expect(rows.map((r) => r.userId)).toEqual([ridersAccount.id]);
  });

  it("notifies just parents when rider has no portal account", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const dad = await mkUser({ role: "PARENT", email: "dad@y.test" });
    await linkParent({ parentUserId: dad.id, riderId: rider.id });

    await notifyRiderAndParents(rider.id, {
      centreId: centre.id,
      type: "exam.passed",
      title: "x",
      body: "x",
    });
    const rows = await prisma.notification.findMany();
    expect(rows.map((r) => r.userId)).toEqual([dad.id]);
  });

  it("silently no-ops when rider doesn't exist", async () => {
    await notifyRiderAndParents("nope", { type: "x", title: "x", body: "x" });
    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(0);
  });
});
