// Reusable Prisma fixture builders for integration tests. Keep these minimal — each
// builder accepts overrides for the fields a test actually cares about and fills the
// rest with sensible defaults. If you find yourself adding a third optional field to a
// builder, the test probably wants to set it inline rather than balloon the helper.

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS } from "@/lib/features";

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

// Test orgs default to plan=starter (matches the schema default) but with
// every OrgFeature row enabled. Legacy tests written before feature gates
// existed get their feature checks satisfied automatically; plan tests still
// see a clean starter→whatever path. Tests that want feature-off behaviour
// override individual rows (see tests/api/feature-gates.test.ts).
export async function mkOrg(name = "Test Org") {
  const org = await prisma.organisation.create({ data: { name, slug: uniq("org") } });
  await prisma.orgFeature.createMany({
    data: FEATURE_KEYS.map((k) => ({ orgId: org.id, featureKey: k, enabled: true })),
  });
  return org;
}

export async function mkCentre(over: {
  orgId?: string;
  name?: string;
  slug?: string;
  managerId?: string | null;
} = {}) {
  const orgId = over.orgId ?? (await mkOrg()).id;
  return prisma.centre.create({
    data: {
      orgId,
      name: over.name ?? "Test Centre",
      slug: over.slug ?? uniq("centre"),
      managerId: over.managerId ?? null,
    },
  });
}

export async function mkUser(over: {
  email?: string;
  password?: string; // plain text; hashed if provided
  passwordHash?: string;
  name?: string;
  role?: string;
  centreId?: string | null;
  status?: string;
} = {}) {
  const passwordHash =
    over.passwordHash ??
    (over.password ? await bcrypt.hash(over.password, 4) : "x"); // low cost rounds for speed
  return prisma.user.create({
    data: {
      email: over.email ?? `${uniq("u")}@test.local`,
      passwordHash,
      name: over.name ?? "Test User",
      role: over.role ?? "COACH",
      centreId: over.centreId ?? null,
      status: over.status ?? "active",
    },
  });
}

// Centre + manager User + the centre.managerId link in one shot — the most common shape
// for sweeps tests that need somewhere to deliver notifications.
export async function mkCentreWithManager(over: { name?: string } = {}) {
  const centre = await mkCentre({ name: over.name });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
  const linked = await prisma.centre.update({
    where: { id: centre.id },
    data: { managerId: manager.id },
  });
  return { centre: linked, manager };
}

export async function mkRider(over: {
  centreId: string;
  firstName?: string;
  lastName?: string;
  dob?: Date;
  mobile?: string;
  email?: string | null;
  fatherPhone?: string | null;
  motherPhone?: string | null;
  status?: string;
}) {
  return prisma.rider.create({
    data: {
      centreId: over.centreId,
      firstName: over.firstName ?? "Riya",
      lastName: over.lastName ?? "Test",
      dob: over.dob ?? new Date("2010-01-01"),
      mobile: over.mobile ?? "9876543210",
      email: over.email === undefined ? "rider@test.local" : over.email,
      fatherPhone: over.fatherPhone === undefined ? "9876500000" : over.fatherPhone,
      motherPhone: over.motherPhone ?? null,
      status: over.status ?? "active",
    },
  });
}

export async function mkBatch(over: { centreId: string; name?: string }) {
  return prisma.batch.create({
    data: {
      centreId: over.centreId,
      name: over.name ?? "Morning",
      dayOfWeek: "Mon,Wed,Fri",
      startTime: "06:00",
      endTime: "07:00",
    },
  });
}

// Link a User (typically with role=PARENT) to a Rider. Returns the link row.
export async function linkParent(over: {
  parentUserId: string;
  riderId: string;
  relationship?: string;
}) {
  return prisma.parentLink.create({
    data: {
      parentUserId: over.parentUserId,
      riderId: over.riderId,
      relationship: over.relationship ?? "father",
    },
  });
}
