// Coverage for the EQUIWINGS daily coach checklist work:
//   1. The idempotent, Equiwings-ONLY seed (34-item general template per centre).
//   2. The "fix" fields — shift + coach declaration on submit, stable-manager
//      countersign (review) on a filed submission.
//
// Mirrors the other API integration suites: per-test fixtures, a mocked
// next/headers cookie jar, route handlers invoked directly.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";
import type { SessionPayload } from "@/lib/auth";
import {
  seedEquiwingsCoachChecklist,
  COACH_CHECKLIST_ITEMS,
  TEMPLATE_NAME,
} from "../../scripts/seed-equiwings-coach-checklist";
import { FEATURE_KEYS } from "@/lib/features";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

async function loginAs(user: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role as Role,
    centreId: user.centreId,
    name: user.name,
    tokenVersion: 0,
  };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function jsonRequest(url: string, body: unknown, method = "POST") {
  return mockReq(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// The seed looks the org up by slug 'equiwings' exactly — create it directly
// (mkOrg auto-generates a unique slug, which wouldn't match).
async function mkEquiwingsOrg() {
  const org = await prisma.organisation.create({ data: { name: "Equiwings", slug: "equiwings" } });
  await prisma.orgFeature.createMany({
    data: FEATURE_KEYS.map((k) => ({ orgId: org.id, featureKey: k, enabled: true })),
  });
  return org;
}

const silent = () => {};

beforeEach(async () => {
  await resetDb();
});

describe("Equiwings coach-checklist seed", () => {
  const N = COACH_CHECKLIST_ITEMS.length;

  it("seeds the full general template for every Equiwings centre, and NO other org", async () => {
    const equiwings = await mkEquiwingsOrg();
    const c1 = await mkCentre({ orgId: equiwings.id, name: "Gurgaon" });
    const c2 = await mkCentre({ orgId: equiwings.id, name: "Delhi" });
    // A different tenant — must be left untouched.
    const other = await mkCentre({ name: "Other Tenant Centre" });

    const summary = await seedEquiwingsCoachChecklist(prisma, silent);
    expect(summary).toMatchObject({ org: "Equiwings", centres: 2, created: 2, skipped: 0 });

    for (const c of [c1, c2]) {
      const tpls = await prisma.checklistTemplate.findMany({
        where: { centreId: c.id, name: TEMPLATE_NAME },
        include: { items: { orderBy: { orderIndex: "asc" } } },
      });
      expect(tpls).toHaveLength(1);
      expect(tpls[0].scope).toBe("general");
      expect(tpls[0].active).toBe(true);
      expect(tpls[0].items).toHaveLength(N);
      // orderIndex is 1..N in form order; labels + sections match the source.
      expect(tpls[0].items.map((i) => i.orderIndex)).toEqual(
        Array.from({ length: N }, (_, i) => i + 1),
      );
      expect(tpls[0].items.map((i) => i.label)).toEqual(COACH_CHECKLIST_ITEMS.map((x) => x.label));
      expect(tpls[0].items.map((i) => i.section)).toEqual(COACH_CHECKLIST_ITEMS.map((x) => x.section));
      // The "Club video shared on WhatsApp" flag from the paper form is present.
      expect(tpls[0].items.some((i) => /whatsapp/i.test(i.label))).toBe(true);
    }

    // The other tenant got nothing.
    const otherTpls = await prisma.checklistTemplate.count({ where: { centreId: other.id } });
    expect(otherTpls).toBe(0);
  });

  it("is non-destructive on re-run when items are unchanged — keeps the template id and submissions", async () => {
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id, name: "Gurgaon" });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await seedEquiwingsCoachChecklist(prisma, silent);
    const firstTpl = await prisma.checklistTemplate.findFirstOrThrow({ where: { centreId: centre.id } });

    // File a submission (with a manager sign-off) against the seeded template.
    const firstItem = await prisma.checklistItem.findFirstOrThrow({ where: { templateId: firstTpl.id } });
    const sub = await prisma.checklistSubmission.create({
      data: {
        templateId: firstTpl.id,
        centreId: centre.id,
        submittedByUserId: coach.id,
        shift: "morning",
        declarationAgreed: true,
        reviewedByUserId: coach.id,
        reviewedAt: new Date(),
        items: { create: [{ itemId: firstItem.id, itemLabel: firstItem.label, status: "done" }] },
      },
    });

    // Re-run with the identical item set → no-op.
    const summary = await seedEquiwingsCoachChecklist(prisma, silent);
    expect(summary).toMatchObject({ centres: 1, created: 0, skipped: 1 });

    // Same template id, same item count — and the submission + sign-off survive.
    const tpls = await prisma.checklistTemplate.findMany({ where: { centreId: centre.id } });
    expect(tpls).toHaveLength(1);
    expect(tpls[0].id).toBe(firstTpl.id);
    expect(await prisma.checklistItem.count({ where: { templateId: firstTpl.id } })).toBe(N);
    const keptSub = await prisma.checklistSubmission.findUnique({ where: { id: sub.id } });
    expect(keptSub).not.toBeNull();
    expect(keptSub!.reviewedByUserId).toBe(coach.id);
  });

  it("rewrites (delete + recreate) when the existing item set differs", async () => {
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id, name: "Gurgaon" });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await seedEquiwingsCoachChecklist(prisma, silent);
    const firstTpl = await prisma.checklistTemplate.findFirstOrThrow({ where: { centreId: centre.id } });
    // Make the on-disk item set diverge from the canonical one.
    const anItem = await prisma.checklistItem.findFirstOrThrow({ where: { templateId: firstTpl.id } });
    await prisma.checklistItem.delete({ where: { id: anItem.id } });
    const sub = await prisma.checklistSubmission.create({
      data: { templateId: firstTpl.id, centreId: centre.id, submittedByUserId: coach.id, shift: "morning", declarationAgreed: true },
    });

    const summary = await seedEquiwingsCoachChecklist(prisma, silent);
    expect(summary).toMatchObject({ centres: 1, created: 1, skipped: 0 });

    const tpls = await prisma.checklistTemplate.findMany({ where: { centreId: centre.id } });
    expect(tpls).toHaveLength(1);
    expect(tpls[0].id).not.toBe(firstTpl.id); // replaced
    expect(await prisma.checklistItem.count({ where: { templateId: tpls[0].id } })).toBe(N);
    // The stale submission was cascaded away; old items gone.
    expect(await prisma.checklistSubmission.findUnique({ where: { id: sub.id } })).toBeNull();
    expect(await prisma.checklistItem.count({ where: { templateId: firstTpl.id } })).toBe(0);
  });

  it("replaces a pre-existing general template (unique centreId+scope), leaving per_horse intact", async () => {
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id, name: "Gurgaon" });
    // Mirror prod: the centre already has a general "Daily ops checklist" + a
    // per_horse template. A naive name-keyed seed would collide on the unique
    // (centreId, scope) constraint instead of replacing the general one.
    const oldGeneral = await prisma.checklistTemplate.create({
      data: {
        centreId: centre.id,
        scope: "general",
        name: "Daily ops checklist",
        items: { create: [{ label: "old item", orderIndex: 1 }] },
      },
    });
    const perHorse = await prisma.checklistTemplate.create({
      data: {
        centreId: centre.id,
        scope: "per_horse",
        name: "Per-horse daily report",
        items: { create: [{ label: "horse item", orderIndex: 1 }] },
      },
    });

    const summary = await seedEquiwingsCoachChecklist(prisma, silent);
    expect(summary).toMatchObject({ centres: 1, created: 1 });

    // The general template is now the coach checklist (old one gone), still one general.
    const generals = await prisma.checklistTemplate.findMany({ where: { centreId: centre.id, scope: "general" } });
    expect(generals).toHaveLength(1);
    expect(generals[0].name).toBe(TEMPLATE_NAME);
    expect(generals[0].id).not.toBe(oldGeneral.id);
    expect(await prisma.checklistItem.count({ where: { templateId: generals[0].id } })).toBe(N);
    // The per_horse template is untouched.
    const ph = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: perHorse.id } });
    expect(ph.name).toBe("Per-horse daily report");
  });

  it("throws (touches nothing) when no Equiwings org exists", async () => {
    await mkCentre({ name: "Some Other Tenant" }); // non-equiwings only
    await expect(seedEquiwingsCoachChecklist(prisma, silent)).rejects.toThrow(/slug 'equiwings' not found/);
    expect(await prisma.checklistTemplate.count()).toBe(0);
  });
});

describe("checklist submit — shift + declaration", () => {
  it("stores shift and declarationAgreed from a general submission", async () => {
    const { POST } = await import("@/app/api/checklists/submit/route");
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await seedEquiwingsCoachChecklist(prisma, silent);
    const tpl = await prisma.checklistTemplate.findFirstOrThrow({
      where: { centreId: centre.id },
      include: { items: true },
    });

    await loginAs(coach);
    const res = await POST(
      jsonRequest("http://localhost/api/checklists/submit", {
        templateId: tpl.id,
        shift: "evening",
        declarationAgreed: true,
        generalNotes: "all good",
        items: tpl.items.map((i) => ({ itemId: i.id, status: "done" })),
      }),
    );
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const stored = await prisma.checklistSubmission.findUniqueOrThrow({ where: { id } });
    expect(stored.shift).toBe("evening");
    expect(stored.declarationAgreed).toBe(true);
    expect(stored.reviewedAt).toBeNull();
  });

  it("rejects an invalid shift value", async () => {
    const { POST } = await import("@/app/api/checklists/submit/route");
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await seedEquiwingsCoachChecklist(prisma, silent);
    const tpl = await prisma.checklistTemplate.findFirstOrThrow({
      where: { centreId: centre.id },
      include: { items: true },
    });

    await loginAs(coach);
    const res = await POST(
      jsonRequest("http://localhost/api/checklists/submit", {
        templateId: tpl.id,
        shift: "midnight", // not in the enum
        declarationAgreed: true,
        items: tpl.items.map((i) => ({ itemId: i.id, status: "done" })),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a general submission with the declaration unticked (server-side, not just UI)", async () => {
    const { POST } = await import("@/app/api/checklists/submit/route");
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await seedEquiwingsCoachChecklist(prisma, silent);
    const tpl = await prisma.checklistTemplate.findFirstOrThrow({ where: { centreId: centre.id }, include: { items: true } });

    await loginAs(coach);
    const res = await POST(
      jsonRequest("http://localhost/api/checklists/submit", {
        templateId: tpl.id,
        shift: "morning",
        // declarationAgreed omitted — a direct API call trying to bypass the tick.
        items: tpl.items.map((i) => ({ itemId: i.id, status: "done" })),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("DECLARATION_REQUIRED");
    expect(await prisma.checklistSubmission.count({ where: { templateId: tpl.id } })).toBe(0);
  });

  it("rejects a general submission with no shift (server-side)", async () => {
    const { POST } = await import("@/app/api/checklists/submit/route");
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await seedEquiwingsCoachChecklist(prisma, silent);
    const tpl = await prisma.checklistTemplate.findFirstOrThrow({ where: { centreId: centre.id }, include: { items: true } });

    await loginAs(coach);
    const res = await POST(
      jsonRequest("http://localhost/api/checklists/submit", {
        templateId: tpl.id,
        declarationAgreed: true,
        // shift omitted
        items: tpl.items.map((i) => ({ itemId: i.id, status: "done" })),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("SHIFT_REQUIRED");
  });

  it("a per_horse submission needs no shift/declaration (still works)", async () => {
    const { POST } = await import("@/app/api/checklists/submit/route");
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    const horse = await prisma.horse.create({ data: { centreId: centre.id, name: "Bijli" } });
    const tpl = await prisma.checklistTemplate.create({
      data: {
        centreId: centre.id,
        scope: "per_horse",
        name: "Per-horse daily report",
        items: { create: [{ label: "Groomed", orderIndex: 1 }] },
      },
      include: { items: true },
    });

    await loginAs(coach);
    const res = await POST(
      jsonRequest("http://localhost/api/checklists/submit", {
        templateId: tpl.id,
        horseId: horse.id,
        items: tpl.items.map((i) => ({ itemId: i.id, status: "done" })),
      }),
    );
    expect(res.status).toBe(200);
    const stored = await prisma.checklistSubmission.findFirstOrThrow({ where: { templateId: tpl.id } });
    expect(stored.shift).toBeNull();
    expect(stored.declarationAgreed).toBe(false);
  });
});

describe("checklist review — manager countersign", () => {
  async function seededSubmission() {
    const equiwings = await mkEquiwingsOrg();
    const centre = await mkCentre({ orgId: equiwings.id });
    const coach = await mkUser({ role: "COACH", centreId: centre.id });
    await seedEquiwingsCoachChecklist(prisma, silent);
    const tpl = await prisma.checklistTemplate.findFirstOrThrow({ where: { centreId: centre.id } });
    const item = await prisma.checklistItem.findFirstOrThrow({ where: { templateId: tpl.id } });
    const sub = await prisma.checklistSubmission.create({
      data: {
        templateId: tpl.id,
        centreId: centre.id,
        submittedByUserId: coach.id,
        shift: "morning",
        declarationAgreed: true,
        items: { create: [{ itemId: item.id, itemLabel: item.label, status: "done" }] },
      },
    });
    return { centre, sub };
  }

  it("a STABLE_MANAGER in the centre can sign off — stamps reviewer + time", async () => {
    const { POST } = await import("@/app/api/checklists/submissions/[submissionId]/review/route");
    const { centre, sub } = await seededSubmission();
    const manager = await mkUser({ role: "STABLE_MANAGER", centreId: centre.id });

    await loginAs(manager);
    const res = await POST(jsonRequest(`http://localhost/api/checklists/submissions/${sub.id}/review`, {}), {
      params: { submissionId: sub.id },
    });
    expect(res.status).toBe(200);
    const stored = await prisma.checklistSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(stored.reviewedByUserId).toBe(manager.id);
    expect(stored.reviewedAt).not.toBeNull();
  });

  it("a COACH cannot sign off (403)", async () => {
    const { POST } = await import("@/app/api/checklists/submissions/[submissionId]/review/route");
    const { centre, sub } = await seededSubmission();
    const coach = await mkUser({ role: "COACH", centreId: centre.id });

    await loginAs(coach);
    const res = await POST(jsonRequest(`http://localhost/api/checklists/submissions/${sub.id}/review`, {}), {
      params: { submissionId: sub.id },
    });
    expect(res.status).toBe(403);
  });

  it("a manager from another centre cannot sign off (cross-centre 403)", async () => {
    const { POST } = await import("@/app/api/checklists/submissions/[submissionId]/review/route");
    const { sub } = await seededSubmission();
    const otherCentre = await mkCentre({ name: "Elsewhere" });
    const otherMgr = await mkUser({ role: "STABLE_MANAGER", centreId: otherCentre.id });

    await loginAs(otherMgr);
    const res = await POST(jsonRequest(`http://localhost/api/checklists/submissions/${sub.id}/review`, {}), {
      params: { submissionId: sub.id },
    });
    expect(res.status).toBe(403);
    const stored = await prisma.checklistSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(stored.reviewedByUserId).toBeNull();
  });
});
