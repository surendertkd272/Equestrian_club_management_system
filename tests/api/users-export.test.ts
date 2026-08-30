// CSV export of the user roster.
//
// A bulk export is the highest-leverage read in the system: one request, every
// user's name, email and phone. So the tests are about the fence (HQ only, own
// org only), the filters matching the page, and the CSV-injection guard —
// because names on this roster arrive from a public form.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
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

const { GET: exportUsers } = await import("@/app/api/users/export/route");

async function signIn(u: { id: string; role: string; centreId: string | null; orgId?: string | null }) {
  cookieJar.clear();
  cookieJar.set("ew_session", {
    value: await signSession({
      userId: u.id,
      role: u.role as never,
      centreId: u.centreId,
      orgId: u.orgId ?? null,
      tokenVersion: 0,
      name: "T",
    } as never),
  });
}

const call = (qs = "") => exportUsers(mockReq(`http://localhost/api/users/export${qs}`));

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  org = await mkOrg("Export Club");
  centre = await mkCentre({ orgId: org.id, name: "Main" });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@x.in" });
});

describe("GET /api/users/export", () => {
  it("returns a CSV of the roster", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "c@x.in", name: "Ravi Kumar" });
    await signIn(hq);

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("users-");

    const text = await res.text();
    expect(text).toContain("Ravi Kumar");
    expect(text).toContain("c@x.in");
  });

  it("never includes a password or a hash", async () => {
    await mkUser({
      role: "COACH",
      centreId: centre.id,
      email: "p@x.in",
      password: "SuperSecret1!",
    });
    await signIn(hq);
    const text = await (await call()).text();
    // The roster is identities. Credentials are a different page with a
    // different gate and its own audit trail.
    expect(text).not.toContain("SuperSecret1!");
    expect(text).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
    expect(text.toLowerCase()).not.toContain("passwordhash");
  });

  it("neutralises a formula smuggled in via a name", async () => {
    // Names reach this table from the public onboarding form. Excel executes
    // a cell starting with "=", and the person opening the roster is the
    // target.
    await mkUser({ role: "GROOM", centreId: centre.id, email: "f@x.in", name: "=1+1+cmd|calc" });
    await signIn(hq);
    const text = await (await call()).text();
    expect(text).not.toMatch(/(^|,)=1\+1/m);
    expect(text).toContain("'=1+1+cmd|calc");
  });

  it("never exports another tenant's users", async () => {
    const other = await mkOrg("Rival");
    const otherCentre = await mkCentre({ orgId: other.id, name: "Rival Centre" });
    await mkUser({ role: "COACH", centreId: otherCentre.id, email: "spy@rival.in", name: "Rival Coach" });
    await signIn(hq);

    const text = await (await call()).text();
    expect(text).not.toContain("Rival Coach");
    expect(text).not.toContain("spy@rival.in");
  });

  it("keeps the org fence even when a search term is supplied", async () => {
    // The q filter is an OR. AND-combined wrongly, a search would widen the
    // result past the caller's own tenant — the exact shape of a leak.
    const other = await mkOrg("Rival2");
    const oc = await mkCentre({ orgId: other.id, name: "RC2" });
    await mkUser({ role: "COACH", centreId: oc.id, email: "target@rival.in", name: "Sharma" });
    await mkUser({ role: "COACH", centreId: centre.id, email: "ours@x.in", name: "Sharma" });
    await signIn(hq);

    const text = await (await call("?q=Sharma")).text();
    expect(text).toContain("ours@x.in");
    expect(text).not.toContain("target@rival.in");
  });

  it("applies the same role filter as the page", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "coach@x.in", name: "A Coach" });
    await mkUser({ role: "GROOM", centreId: centre.id, email: "groom@x.in", name: "B Groom" });
    await signIn(hq);

    const text = await (await call("?role=COACH")).text();
    expect(text).toContain("coach@x.in");
    expect(text).not.toContain("groom@x.in");
  });

  it("records the export", async () => {
    await mkUser({ role: "COACH", centreId: centre.id, email: "a@x.in" });
    await signIn(hq);
    await call();
    const log = await prisma.auditLog.findFirst({ where: { action: "user.export" } });
    // Bulk PII leaving the system should be answerable afterwards.
    expect(log).not.toBeNull();
    expect(log?.userId).toBe(hq.id);
  });

  it("refuses a centre manager", async () => {
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@x.in" });
    await signIn({ id: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, orgId: org.id });
    expect((await call()).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    cookieJar.clear();
    expect((await call()).status).toBe(401);
  });
});
