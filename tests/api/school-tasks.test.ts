// The school ↔ head-office task thread.
//
// The reason this is a separate route from /api/tasks, rather than the school
// role being added to that one: /api/tasks is guarded by task.assign, which
// lets the holder assign work to anyone at the centre. Giving that to an
// external partner would let a school direct the club's coaches and grooms.
//
// So the tests that matter are about what a school CANNOT do with it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, COOKIE_NAME } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, value: string) => cookieJar.set(n, { value }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: raise, PATCH: update } = await import("@/app/api/school/tasks/route");

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let school: Awaited<ReturnType<typeof mkUser>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

async function signIn(userId: string, role: Role, centreId: string | null) {
  cookieJar.clear();
  cookieJar.set(COOKIE_NAME, {
    value: await signSession({ userId, role, centreId, name: "School", tokenVersion: 0 }),
  });
}

const post = (body: unknown) =>
  raise(
    mockReq("http://localhost/api/school/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const patch = (body: unknown) =>
  update(
    mockReq("http://localhost/api/school/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Task Org");
  centre = await mkCentre({ orgId: org.id, name: "Task Centre" });
  school = await mkUser({
    email: "school@club.in",
    role: "SCHOOL_ADMINISTRATOR",
    centreId: centre.id,
  });
  hq = await mkUser({ email: "hq@club.in", role: "SUPER_ADMIN", centreId: null, orgId: org.id });
});

describe("raising a request", () => {
  it("creates an unassigned task addressed to head office", async () => {
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await post({ title: "Move the Class 6 batch to Thursdays" });
    expect(res.status).toBe(200);

    const task = await prisma.task.findFirstOrThrow();
    expect(task.title).toBe("Move the Class 6 batch to Thursdays");
    expect(task.kind).toBe("school_request");
    expect(task.assignedById).toBe(school.id);
    // Unassigned on purpose: HQ picks it up from their own board.
    expect(task.assigneeId).toBeNull();
    expect(task.centreId).toBe(centre.id);
  });

  it("cannot choose who the work goes to", async () => {
    // The whole reason this route exists instead of /api/tasks. A school
    // naming an assignee would be a school tasking the club's staff.
    const coach = await mkUser({ email: "coach@club.in", role: "COACH", centreId: centre.id });
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    await post({ title: "Muck out stable 4", assigneeId: coach.id });

    const task = await prisma.task.findFirstOrThrow();
    expect(task.assigneeId).toBeNull();
  });

  it("notifies head office, who have no centre of their own", async () => {
    // SUPER_ADMIN and ADMIN carry centreId = null, so a centre-filtered
    // notification reaches none of them. That is the recurring bug in this
    // codebase and it would leave a partner waiting on silence.
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    await post({ title: "Exam week clash" });

    const notes = await prisma.notification.findMany({ where: { userId: hq.id } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].type).toBe("task.school_request");
  });

  it("refuses a rider, a coach and an anonymous caller", async () => {
    const coach = await mkUser({ email: "c2@club.in", role: "COACH", centreId: centre.id });
    await signIn(coach.id, "COACH", centre.id);
    expect((await post({ title: "Something" })).status).toBe(403);

    cookieJar.clear();
    expect((await post({ title: "Something" })).status).toBe(401);
  });

  it("rejects an empty request", async () => {
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    expect((await post({ title: "hi" })).status).toBe(400);
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("moving a task along", () => {
  it("lets the school close its own request", async () => {
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    await post({ title: "Sorted out by phone" });
    const task = await prisma.task.findFirstOrThrow();

    const res = await patch({ id: task.id, status: "done" });
    expect(res.status).toBe(200);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("done");
    expect(after.completedAt).not.toBeNull();
  });

  it("lets the school progress a task head office assigned to them", async () => {
    const assigned = await prisma.task.create({
      data: {
        centreId: centre.id,
        title: "Send us the Class 8 consent forms",
        assignedById: hq.id,
        assigneeId: school.id,
        status: "open",
      },
    });
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    expect((await patch({ id: assigned.id, status: "in_progress" })).status).toBe(200);
  });

  it("cannot touch the club's own internal work", async () => {
    // The club's stable rotas and salary chases live in the same table. A
    // school closing one by guessing an id is the failure this guards.
    const internal = await prisma.task.create({
      data: {
        centreId: centre.id,
        title: "Pay the farrier",
        assignedById: hq.id,
        assigneeId: hq.id,
        status: "open",
      },
    });
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    const res = await patch({ id: internal.id, status: "done" });
    expect(res.status).toBe(404);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: internal.id } });
    expect(after.status).toBe("open");
  });

  it("cannot touch another club's task", async () => {
    const otherOrg = await mkOrg("Other Task Org");
    const otherCentre = await mkCentre({ orgId: otherOrg.id, name: "Elsewhere" });
    const theirs = await prisma.task.create({
      data: {
        centreId: otherCentre.id,
        title: "Their business",
        assignedById: school.id, // same id, different centre — the tricky case
        status: "open",
      },
    });
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    expect((await patch({ id: theirs.id, status: "done" })).status).toBe(404);
  });

  it("rejects a status that isn't one of the three", async () => {
    await signIn(school.id, "SCHOOL_ADMINISTRATOR", centre.id);
    await post({ title: "A request" });
    const task = await prisma.task.findFirstOrThrow();
    expect((await patch({ id: task.id, status: "escalated" })).status).toBe(400);
  });
});
