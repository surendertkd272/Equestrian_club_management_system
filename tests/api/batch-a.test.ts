// Batch A: smoke tests for the four quick-win additions.
//   1. Medicine category enum expansion (validation accepts new keys)
//   2. Centre emergency contacts JSON round-trip
//   3. Horse insurance fields round-trip
//   4. Horse insurance expiry sweep digests the manager

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { createMedicineSchema } from "@/lib/schemas/medicine";
import { sweepHorseInsuranceExpiry } from "@/lib/sweeps";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { PATCH: patchCentre } = await import("@/app/api/centres/[id]/route");
const { POST: createHorse } = await import("@/app/api/horses/route");
const { PATCH: patchHorse } = await import("@/app/api/horses/[id]/route");

async function loginSuper() {
  const sup = await mkUser({ role: "SUPER_ADMIN", centreId: null });
  const payload: SessionPayload = {
    userId: sup.id,
    role: "SUPER_ADMIN",
    centreId: null,
    name: sup.name,
  };
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("Batch A.1 — medicine categories", () => {
  it("accepts the newly-added categories", () => {
    const base = {
      name: "X",
      batchNo: "B1",
      expDate: "2030-01-01",
      qty: 1,
    };
    for (const cat of ["antihistamine", "sedative", "eye", "gastric", "electrolyte", "antitoxin"]) {
      const r = createMedicineSchema.safeParse({ ...base, category: cat });
      expect(r.success, `category ${cat} should validate`).toBe(true);
    }
  });
  it("still rejects nonsense categories", () => {
    const r = createMedicineSchema.safeParse({
      name: "X",
      batchNo: "B1",
      expDate: "2030-01-01",
      qty: 1,
      category: "moondust",
    });
    expect(r.success).toBe(false);
  });
});

describe("Batch A.3 — Centre emergency contacts", () => {
  it("PATCH /api/centres/[id] stores + retrieves the contacts JSON", async () => {
    await loginSuper();
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });

    const r = await patchCentre(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          emergencyContacts: [
            { type: "vet", label: "Dr. Ramesh", number: "+91 98765 12345" },
            { type: "ambulance", label: "Apollo Vet", number: "1066" },
          ],
        }),
      }),
      { params: { id: centre.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.centre.findUniqueOrThrow({ where: { id: centre.id } });
    // emergencyContactsJson is now a jsonb column — Prisma returns the
    // parsed array directly. No JSON.parse needed.
    const parsed = after.emergencyContactsJson as Array<{ type?: string; number?: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("vet");
    expect(parsed[1].number).toBe("1066");
  });

  it("clears the JSON when sent an empty array", async () => {
    await loginSuper();
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    await prisma.centre.update({
      where: { id: centre.id },
      data: { emergencyContactsJson: JSON.stringify([{ type: "vet", label: "X", number: "1" }]) },
    });

    const r = await patchCentre(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ emergencyContacts: [] }),
      }),
      { params: { id: centre.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.centre.findUniqueOrThrow({ where: { id: centre.id } });
    expect(after.emergencyContactsJson).toBeNull();
  });
});

describe("Batch A.4 — Horse insurance fields + sweep", () => {
  it("POST /api/horses persists insurer / policy / premium / validity", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    cookieJar.clear();
    cookieJar.set("ew_session", {
      value: await signSession({
        userId: mgr.id,
        role: "CENTRE_MANAGER",
        centreId: centre.id,
        name: mgr.name,
      }),
    });

    const r = await createHorse(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Bijli",
          ownership: "club",
          identificationMarks: "White blaze, near-hind sock",
          insurerName: "Bajaj Allianz",
          insurancePolicyNo: "POL-12345",
          insurancePremium: 18000,
          insuranceValidFrom: "2026-01-01",
          insuranceValidTo: "2027-01-01",
        }),
      }),
    );
    expect(r.status).toBe(200);

    const horses = await prisma.horse.findMany({ where: { centreId: centre.id } });
    expect(horses).toHaveLength(1);
    expect(horses[0].insurerName).toBe("Bajaj Allianz");
    expect(horses[0].insurancePolicyNo).toBe("POL-12345");
    expect(horses[0].insurancePremium).toBe(18000);
    expect(horses[0].insuranceValidTo).not.toBeNull();
  });

  it("sweep notifies the centre manager about horses with insurance expiring < 30 days", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });

    // Expiring in 10 days
    await prisma.horse.create({
      data: {
        centreId: centre.id,
        name: "Champa",
        insuranceValidTo: new Date(Date.now() + 10 * 86400000),
      },
    });
    // Already expired
    await prisma.horse.create({
      data: {
        centreId: centre.id,
        name: "Raja",
        insuranceValidTo: new Date(Date.now() - 5 * 86400000),
      },
    });
    // Fine — 365 days out
    await prisma.horse.create({
      data: {
        centreId: centre.id,
        name: "Surya",
        insuranceValidTo: new Date(Date.now() + 365 * 86400000),
      },
    });

    const result = await sweepHorseInsuranceExpiry();
    expect(result.scanned).toBe(2); // Surya excluded (> 30 days)
    expect(result.notified).toBe(1);

    const inbox = await prisma.notification.findMany({ where: { userId: mgr.id } });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("horse.insurance_expiry_digest");
    expect(inbox[0].body).toContain("Champa");
    expect(inbox[0].body).toContain("Raja");
  });

  it("sweep dedups: rerun within 23 hours does nothing", async () => {
    const centre = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await prisma.centre.update({ where: { id: centre.id }, data: { managerId: mgr.id } });
    await prisma.horse.create({
      data: {
        centreId: centre.id,
        name: "X",
        insuranceValidTo: new Date(Date.now() + 5 * 86400000),
      },
    });

    await sweepHorseInsuranceExpiry();
    const second = await sweepHorseInsuranceExpiry();
    expect(second.notified).toBe(0);
    expect(second.skipped).toBe(1);
  });
});

describe("Horse identification marks", () => {
  // A horse is identified by its markings the way a person is by a photo —
  // whorls, blazes, socks, scars are what an equine passport records, and
  // what tells two bay geldings apart when one of them is injured. Required
  // when onboarding a horse; NOT retroactively required, because horses
  // already on file predate the field.

  async function asManager(centreId: string) {
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId });
    cookieJar.clear();
    cookieJar.set("ew_session", {
      value: await signSession({
        userId: mgr.id,
        role: "CENTRE_MANAGER",
        centreId,
        name: mgr.name,
      }),
    });
    return mgr;
  }

  it("refuses a new horse with no identification marks", async () => {
    const centre = await mkCentre();
    await asManager(centre.id);

    const r = await createHorse(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Bijli", ownership: "club" }),
      }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("VALIDATION");
    expect(await prisma.horse.count({ where: { centreId: centre.id } })).toBe(0);
  });

  it("refuses whitespace dressed up as an answer", async () => {
    const centre = await mkCentre();
    await asManager(centre.id);

    const r = await createHorse(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Bijli", identificationMarks: "" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("persists the marks on a new horse", async () => {
    const centre = await mkCentre();
    await asManager(centre.id);

    const r = await createHorse(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Bijli",
          identificationMarks: "White blaze; both hind socks; whorl left shoulder",
        }),
      }),
    );
    expect(r.status).toBe(200);

    const horse = await prisma.horse.findFirstOrThrow({ where: { centreId: centre.id } });
    expect(horse.identificationMarks).toBe("White blaze; both hind socks; whorl left shoulder");
  });

  it("lets a horse on file before the field was added keep being edited", async () => {
    // The regression this guards: making the field required must not strand
    // every existing horse behind a form they cannot save.
    const centre = await mkCentre();
    await asManager(centre.id);
    const legacy = await prisma.horse.create({
      data: { centreId: centre.id, name: "Champa", stableNo: "A1" },
    });
    expect(legacy.identificationMarks).toBeNull();

    const r = await patchHorse(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ stableNo: "B2" }),
      }),
      { params: { id: legacy.id } },
    );
    expect(r.status).toBe(200);
    const after = await prisma.horse.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.stableNo).toBe("B2");
    expect(after.identificationMarks).toBeNull();
  });

  it("lets that horse have its marks filled in later", async () => {
    const centre = await mkCentre();
    await asManager(centre.id);
    const legacy = await prisma.horse.create({
      data: { centreId: centre.id, name: "Champa" },
    });

    const r = await patchHorse(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ identificationMarks: "Star on forehead" }),
      }),
      { params: { id: legacy.id } },
    );
    expect(r.status).toBe(200);
    const after = await prisma.horse.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.identificationMarks).toBe("Star on forehead");
  });
});
