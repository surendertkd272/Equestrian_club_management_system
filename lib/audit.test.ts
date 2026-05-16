import { describe, it, expect, beforeEach } from "vitest";
import { audit } from "./audit";
import { prisma } from "./prisma";
import { resetDb } from "../tests/helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("audit (writes through real Prisma)", () => {
  it("writes required fields and leaves optionals null", async () => {
    await audit({ action: "test.simple", tableName: "thing", rowId: "row_1" });

    const rows = await prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.action).toBe("test.simple");
    expect(r.tableName).toBe("thing");
    expect(r.rowId).toBe("row_1");
    expect(r.userId).toBeNull();
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.ip).toBeNull();
    expect(r.userAgent).toBeNull();
    expect(r.at).toBeInstanceOf(Date);
  });

  it("stringifies before/after as JSON", async () => {
    await audit({
      action: "test.update",
      tableName: "thing",
      rowId: "row_2",
      before: { status: "draft" },
      after: { status: "published", count: 3 },
    });

    const r = await prisma.auditLog.findFirstOrThrow({ where: { rowId: "row_2" } });
    expect(r.before).toBe(JSON.stringify({ status: "draft" }));
    expect(r.after).toBe(JSON.stringify({ status: "published", count: 3 }));
  });

  it("forwards ip and userAgent verbatim", async () => {
    await audit({
      action: "test.ip",
      tableName: "thing",
      rowId: "row_3",
      ip: "203.0.113.5",
      userAgent: "Mozilla/5.0 testing",
    });
    const r = await prisma.auditLog.findFirstOrThrow({ where: { rowId: "row_3" } });
    expect(r.ip).toBe("203.0.113.5");
    expect(r.userAgent).toBe("Mozilla/5.0 testing");
  });

  it("stores userId when provided (no FK validation since user row may not exist in audit-only tests)", async () => {
    // Insert a user row first so the optional FK resolves cleanly.
    const u = await prisma.user.create({
      data: {
        email: `audit-user-${Date.now()}@test.local`,
        passwordHash: "x",
        name: "Audit Tester",
        role: "COACH",
      },
    });
    await audit({ userId: u.id, action: "test.user", tableName: "thing", rowId: "row_4" });

    const r = await prisma.auditLog.findFirstOrThrow({ where: { rowId: "row_4" } });
    expect(r.userId).toBe(u.id);
  });

  it("treats falsy before/after as null (not the string 'null' or 'false')", async () => {
    await audit({
      action: "test.falsy",
      tableName: "thing",
      rowId: "row_5",
      before: null,
      after: undefined,
    });
    const r = await prisma.auditLog.findFirstOrThrow({ where: { rowId: "row_5" } });
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
  });

  it("isolates between tests (resetDb cleared the prior 5 rows)", async () => {
    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });
});
