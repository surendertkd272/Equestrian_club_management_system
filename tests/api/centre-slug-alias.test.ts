// A renamed centre must not kill the registration links already in circulation.
//
// The public URL is ?centre=<slug>. Those get printed on noticeboards and
// forwarded through school WhatsApp groups, so renaming a slug silently
// breaks every copy already out there — and the failure is invisible: the
// page stops naming a centre, and a parent concludes the club has closed
// rather than asking for a new link.
//
// Equiwings Noida was created as "gurgaon" (wrong city) and renamed. This is
// the guarantee that the links already sent still work.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";

let org: Awaited<ReturnType<typeof mkOrg>>;

/** The exact lookup app/onboarding/page.tsx performs. */
async function resolve(slug: string) {
  return (
    (await prisma.centre.findUnique({ where: { slug } })) ??
    (await prisma.centre.findFirst({ where: { previousSlugs: { has: slug } } }))
  );
}

beforeEach(async () => {
  await resetDb();
  org = await mkOrg("Alias Club");
});

describe("a renamed centre keeps answering to its old link", () => {
  it("resolves the old slug to the same centre", async () => {
    const c = await mkCentre({ orgId: org.id, name: "Equiwings Noida", slug: "noida" });
    await prisma.centre.update({
      where: { id: c.id },
      data: { previousSlugs: ["gurgaon"] },
    });

    const viaOld = await resolve("gurgaon");
    const viaNew = await resolve("noida");
    expect(viaOld?.id).toBe(c.id);
    expect(viaNew?.id).toBe(c.id);
  });

  it("still resolves nothing for a slug nobody ever had", async () => {
    await mkCentre({ orgId: org.id, name: "Equiwings Noida", slug: "noida" });
    // The page is public and RLS-bypassed; an unknown slug must stay unknown
    // rather than falling through to some other club.
    expect(await resolve("not-a-real-centre")).toBeNull();
  });

  it("prefers a live slug over another centre's old one", async () => {
    // If a freed-up slug is later reused by a different club, the CURRENT
    // owner must win — otherwise a new club's link would quietly deliver
    // riders to the centre that used to hold the name.
    const old = await mkCentre({ orgId: org.id, name: "Old Club", slug: "old-club" });
    await prisma.centre.update({ where: { id: old.id }, data: { previousSlugs: ["shared"] } });
    const current = await mkCentre({ orgId: org.id, name: "Current Club", slug: "shared" });

    const hit = await resolve("shared");
    expect(hit?.id).toBe(current.id);
  });

  it("defaults to no aliases, so nothing resolves by accident", async () => {
    const c = await mkCentre({ orgId: org.id, name: "Plain", slug: "plain" });
    expect(c.previousSlugs).toEqual([]);
  });
});
