// UX phase tests — forgot-password, must-change-password, global search,
// notification preferences honored.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, verifyPassword, hashPassword, type SessionPayload } from "@/lib/auth";
import { hashToken } from "@/lib/password-reset";
import { notify } from "@/lib/notify";
import { isInQuietHours, mergePrefs } from "@/lib/notify-prefs";
import { mockReq } from "../helpers/request";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: loginPost } = await import("@/app/api/auth/login/route");
const { POST: forgotPost } = await import("@/app/api/auth/forgot-password/route");
const { POST: resetPost } = await import("@/app/api/auth/reset-password/route");
const { GET: searchGet } = await import("@/app/api/search/route");
const { PATCH: prefsPatch } = await import("@/app/api/account/notif-prefs/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("Must-change-password gate", () => {
  it("login returns /account/rotate when mustChangePassword=true", async () => {
    const u = await mkUser({ email: "rot@x.test", password: "temp1234" });
    await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });

    const r = await loginPost(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "rot@x.test", password: "temp1234" }),
      }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).redirect).toBe("/account/rotate");
  });

  it("login returns role-aware redirect when flag is clear", async () => {
    const c = await mkCentre();
    await mkUser({
      email: "ok@x.test",
      password: "real-password",
      role: "CENTRE_MANAGER",
      centreId: c.id,
    });
    const r = await loginPost(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "ok@x.test", password: "real-password" }),
      }),
    );
    const data = await r.json();
    expect(data.redirect).toBe("/dashboard");
  });
});

describe("Forgot-password flow", () => {
  it("always returns 200 even for unknown emails (no enumeration leak)", async () => {
    const r = await forgotPost(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ email: "nobody@x.test" }) }),
    );
    expect(r.status).toBe(200);
  });

  it("issues a single-use token + redeem flips mustChangePassword=false", async () => {
    const u = await mkUser({ email: "lost@x.test", password: "oldpw" });
    // Pretend the email/SMS were delivered: we directly fetch the token row
    // since dev email transport doesn't persist it for us.
    await forgotPost(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ email: "lost@x.test" }) }),
    );

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: u.id } });
    expect(tokens).toHaveLength(1);

    // We don't have the plaintext (it was only in the email body) — but for
    // the test we can fabricate a known plaintext, overwrite the hashed row,
    // and redeem against it.
    const plain = "test-token-plain-value-32chars-okok";
    await prisma.passwordResetToken.update({
      where: { id: tokens[0].id },
      data: { tokenHash: hashToken(plain) },
    });

    const redeem = await resetPost(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ token: plain, newPassword: "NewPass8!" }),
      }),
    );
    expect(redeem.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(await verifyPassword("NewPass8!", after.passwordHash)).toBe(true);

    // Second redeem with same token is rejected.
    const replay = await resetPost(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ token: plain, newPassword: "AnotherPw1!" }),
      }),
    );
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("TOKEN_USED");
  });

  it("expired tokens return 410", async () => {
    const u = await mkUser({ email: "exp@x.test" });
    const plain = "expired-token-plain-value-1234567890";
    await prisma.passwordResetToken.create({
      data: {
        userId: u.id,
        tokenHash: hashToken(plain),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const r = await resetPost(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ token: plain, newPassword: "NewPw1234!" }),
      }),
    );
    expect(r.status).toBe(410);
  });
});

describe("Global search /api/search", () => {
  it("401 without session", async () => {
    const r = await searchGet(mockReq("http://localhost/api/search?q=foo"));
    expect(r.status).toBe(401);
  });

  it("returns 0 hits for short queries", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await loginAs({ userId: u.id, role: "CENTRE_MANAGER", centreId: c.id, name: u.name });
    const r = await searchGet(mockReq("http://localhost/api/search?q=a"));
    expect(r.status).toBe(200);
    expect((await r.json()).hits).toEqual([]);
  });

  it("finds riders by first/last name", async () => {
    const c = await mkCentre();
    const u = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await mkRider({ centreId: c.id, firstName: "Riya", lastName: "Sharma" });
    await mkRider({ centreId: c.id, firstName: "Aarav", lastName: "Patel" });
    await loginAs({ userId: u.id, role: "CENTRE_MANAGER", centreId: c.id, name: u.name });

    const r = await searchGet(mockReq("http://localhost/api/search?q=Riya"));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.hits.some((h: any) => h.primary === "Riya Sharma")).toBe(true);
    expect(data.hits.some((h: any) => h.primary === "Aarav Patel")).toBe(false);
  });

  it("respects centre scoping for non-SUPER_ADMIN", async () => {
    const a = await mkCentre();
    const b = await mkCentre();
    await mkRider({ centreId: a.id, firstName: "Atest", lastName: "Aname" });
    await mkRider({ centreId: b.id, firstName: "Btest", lastName: "Bname" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: a.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: a.id, name: mgr.name });

    const r = await searchGet(mockReq("http://localhost/api/search?q=test"));
    const data = await r.json();
    const names = data.hits.map((h: any) => h.primary);
    expect(names).toContain("Atest Aname");
    expect(names).not.toContain("Btest Bname");
  });
});

describe("Notification preferences", () => {
  it("inApp=false suppresses non-critical in-app notify", async () => {
    const c = await mkCentre();
    const u = await mkUser({ centreId: c.id });
    await prisma.user.update({
      where: { id: u.id },
      data: { notifPrefsJson: JSON.stringify({ inApp: false }) },
    });

    await notify({
      userId: u.id,
      type: "rider.attendance_low",
      title: "Quiet update",
      body: "Nothing important",
    });

    const rows = await prisma.notification.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(0);
  });

  it("critical notifications bypass the inApp toggle", async () => {
    const c = await mkCentre();
    const u = await mkUser({ centreId: c.id });
    await prisma.user.update({
      where: { id: u.id },
      data: { notifPrefsJson: JSON.stringify({ inApp: false }) },
    });

    await notify({
      userId: u.id,
      type: "injury.reported",
      title: "Severe injury",
      body: "needs vet",
      criticality: "critical",
    });

    const rows = await prisma.notification.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
  });

  it("PATCH /api/account/notif-prefs merges + persists", async () => {
    const c = await mkCentre();
    const u = await mkUser({ centreId: c.id });
    await loginAs({ userId: u.id, role: u.role as Role, centreId: c.id, name: u.name });

    const r = await prefsPatch(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ sms: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" }),
      }),
    );
    expect(r.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const prefs = mergePrefs(after.notifPrefsJson);
    expect(prefs.sms).toBe(true);
    expect(prefs.quietHoursStart).toBe("22:00");
    expect(prefs.email).toBe(true); // unchanged default
  });

  it("isInQuietHours covers overnight windows", () => {
    const prefs = mergePrefs(JSON.stringify({ quietHoursStart: "22:00", quietHoursEnd: "07:00" }));
    // 23:30 — inside the window
    const nightTime = new Date();
    nightTime.setHours(23, 30, 0, 0);
    expect(isInQuietHours(prefs, nightTime)).toBe(true);
    // 09:00 — outside
    const morning = new Date();
    morning.setHours(9, 0, 0, 0);
    expect(isInQuietHours(prefs, morning)).toBe(false);
  });
});
