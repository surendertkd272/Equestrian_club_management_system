// A check marked "not done" must reach the people who can act on it, and the
// full report must be readable by them — and by nobody at another club.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkOrg, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";
import type { SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: () => new Headers(),
}));

const sent: { to: string; subject: string; html: string }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async (o: { to: string; subject: string; html: string }) => {
    sent.push(o);
    return { ok: true as const };
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

async function setup() {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const coach = await mkUser({ role: "COACH", centreId: centre.id, name: "Ritu Coach" });
  const manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Neha Manager" });
  const stable = await mkUser({ role: "STABLE_MANAGER", centreId: centre.id, name: "Kamal Stable" });
  const hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, name: "Nilesh HQ" });
  const groom = await mkUser({ role: "GROOM", centreId: centre.id, name: "Raju Groom" });
  // Another club entirely: its HQ and manager must hear nothing.
  const otherOrg = await mkOrg("Other");
  const otherCentre = await mkCentre({ orgId: otherOrg.id });
  const otherHq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: otherOrg.id });
  const otherManager = await mkUser({ role: "CENTRE_MANAGER", centreId: otherCentre.id });
  const horse = await prisma.horse.create({ data: { centreId: centre.id, name: "Bijli" } });
  const tpl = await prisma.checklistTemplate.create({
    data: {
      centreId: centre.id,
      scope: "per_horse",
      name: "Per-horse daily report",
      items: {
        create: [
          { label: "Hooves picked and cleaned", section: "Grooming", orderIndex: 1 },
          { label: "Water refilled", section: "Stable", orderIndex: 2 },
          { label: "Rug checked", section: "Stable", orderIndex: 3 },
        ],
      },
    },
    include: { items: { orderBy: { orderIndex: "asc" } } },
  });
  return { org, centre, coach, manager, stable, hq, groom, otherHq, otherManager, otherCentre, horse, tpl };
}

async function submit(
  f: Awaited<ReturnType<typeof setup>>,
  statuses: ("done" | "not_done" | "na")[],
) {
  const { POST } = await import("@/app/api/checklists/submit/route");
  await loginAs(f.coach);
  const res = await POST(
    mockReq("http://localhost/api/checklists/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: f.tpl.id,
        horseId: f.horse.id,
        items: f.tpl.items.map((i, n) => ({
          itemId: i.id,
          status: statuses[n],
          ...(statuses[n] === "not_done" ? { remarks: "farrier coming tomorrow" } : {}),
        })),
      }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()).id as string;
}

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://cms.example.test";
});

describe("checklist issue alert", () => {
  it("tells the manager, stable manager and HQ which checks were not done — not the submitter, not another club", async () => {
    const f = await setup();
    const id = await submit(f, ["not_done", "done", "done"]);

    const notes = await prisma.notification.findMany({ where: { type: "checklist.issues" } });
    const to = new Set(notes.map((n) => n.userId));
    expect(to).toEqual(new Set([f.manager.id, f.stable.id, f.hq.id]));
    expect(to.has(f.coach.id)).toBe(false);
    expect(to.has(f.groom.id)).toBe(false);
    expect(to.has(f.otherHq.id)).toBe(false);
    expect(to.has(f.otherManager.id)).toBe(false);

    const n = notes[0];
    expect(n.title).toContain("1 check not done");
    expect(n.title).toContain("Ritu Coach");
    expect(n.title).toContain("Bijli");
    expect(n.body).toContain("Hooves picked and cleaned");
    expect(n.link).toBe(`/checklists/submissions/${id}`);

    // Email too, carrying the item, the remark and an absolute link.
    expect(sent.map((s) => s.to).sort()).toEqual([f.manager.email, f.stable.email, f.hq.email].sort());
    expect(sent[0].html).toContain("Hooves picked and cleaned");
    expect(sent[0].html).toContain("farrier coming tomorrow");
    expect(sent[0].html).toContain(`https://cms.example.test/checklists/submissions/${id}`);
  });

  it("stays quiet when everything was done or not applicable", async () => {
    const f = await setup();
    await submit(f, ["done", "na", "done"]);
    expect(await prisma.notification.count({ where: { type: "checklist.issues" } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("respects a recipient who switched email off, but still alerts them in-app", async () => {
    const f = await setup();
    await prisma.user.update({ where: { id: f.hq.id }, data: { notifPrefsJson: { email: false } } });
    await submit(f, ["not_done", "not_done", "done"]);
    expect(sent.map((s) => s.to)).not.toContain(f.hq.email);
    expect(await prisma.notification.count({ where: { type: "checklist.issues", userId: f.hq.id } })).toBe(1);
  });
});

describe("checklist submission report access", () => {
  it("opens for the centre's reviewers, HQ and the submitter; not other staff or other clubs", async () => {
    const { checklistSubmissionAccess } = await import("@/lib/checklist-access");
    const f = await setup();
    const id = await submit(f, ["not_done", "done", "done"]);
    const sub = await prisma.checklistSubmission.findUniqueOrThrow({ where: { id } });
    const as = (u: { id: string; role: string; centreId: string | null }) =>
      checklistSubmissionAccess({ userId: u.id, role: u.role, centreId: u.centreId }, sub);

    expect(await as(f.manager)).toEqual({ view: true, review: true });
    expect(await as(f.stable)).toEqual({ view: true, review: true });
    expect(await as(f.hq)).toEqual({ view: true, review: true });
    // The coach who filed it can read it back, but not sign it off.
    expect(await as(f.coach)).toEqual({ view: true, review: false });
    expect(await as(f.groom)).toEqual({ view: false, review: false });
    expect(await as(f.otherHq)).toEqual({ view: false, review: false });
    expect(await as(f.otherManager)).toEqual({ view: false, review: false });
  });
});
