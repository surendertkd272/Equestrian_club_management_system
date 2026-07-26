import { describe, it, expect } from "vitest";
import { can, requirePerm, permissionsFor } from "./permissions";

describe("can", () => {
  it("SUPER_ADMIN can do everything in the matrix", () => {
    expect(can("SUPER_ADMIN", "centre.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "audit.read")).toBe(true);
    expect(can("SUPER_ADMIN", "certificate.issue")).toBe(true);
    expect(can("SUPER_ADMIN", "finance.write")).toBe(true);
  });

  it("CENTRE_MANAGER has rider + finance + staff but not centre.manage", () => {
    expect(can("CENTRE_MANAGER", "rider.write")).toBe(true);
    expect(can("CENTRE_MANAGER", "finance.write")).toBe(true);
    expect(can("CENTRE_MANAGER", "staff.manage")).toBe(true);
    expect(can("CENTRE_MANAGER", "certificate.issue")).toBe(true);
    expect(can("CENTRE_MANAGER", "centre.manage")).toBe(false);
    expect(can("CENTRE_MANAGER", "audit.read")).toBe(false);
  });

  it("COACH is limited to read/attendance/progress (plus self-leave + batches)", () => {
    expect(can("COACH", "attendance.mark")).toBe(true);
    expect(can("COACH", "progress.write")).toBe(true);
    expect(can("COACH", "rider.read")).toBe(true);
    expect(can("COACH", "task.complete")).toBe(true);
    expect(can("COACH", "leave.request")).toBe(true);
    // Coaches manage their own batches (batch.manage), but this must NOT be
    // staff.manage — that gates staff USER-ACCOUNT creation (escalation hole).
    expect(can("COACH", "batch.manage")).toBe(true);
    expect(can("COACH", "staff.manage")).toBe(false);
    expect(can("COACH", "rider.write")).toBe(false);
    expect(can("COACH", "exam.score")).toBe(false);
    expect(can("COACH", "finance.read")).toBe(false);
    expect(can("COACH", "leave.approve")).toBe(false);
  });

  it("HEAD_COACH extends COACH with rider.write + exam scheduling + leave approval", () => {
    expect(can("HEAD_COACH", "rider.write")).toBe(true);
    expect(can("HEAD_COACH", "exam.schedule")).toBe(true);
    expect(can("HEAD_COACH", "exam.score")).toBe(true);
    expect(can("HEAD_COACH", "task.assign")).toBe(true);
    expect(can("HEAD_COACH", "leave.approve")).toBe(true);
    expect(can("HEAD_COACH", "asset.manage")).toBe(false);
    expect(can("HEAD_COACH", "finance.read")).toBe(false);
  });

  it("STABLE_MANAGER owns horses + tack but not finance or rider write", () => {
    expect(can("STABLE_MANAGER", "horse.manage")).toBe(true);
    expect(can("STABLE_MANAGER", "asset.manage")).toBe(true);
    expect(can("STABLE_MANAGER", "task.assign")).toBe(true);
    expect(can("STABLE_MANAGER", "leave.approve")).toBe(true);
    expect(can("STABLE_MANAGER", "rider.write")).toBe(false);
    expect(can("STABLE_MANAGER", "finance.read")).toBe(false);
  });

  it("INVENTORY_MANAGER covers asset + medicine stock but does not prescribe", () => {
    expect(can("INVENTORY_MANAGER", "asset.manage")).toBe(true);
    expect(can("INVENTORY_MANAGER", "medicine.manage")).toBe(true);
    expect(can("INVENTORY_MANAGER", "medicine.prescribe")).toBe(false);
    expect(can("INVENTORY_MANAGER", "horse.manage")).toBe(false);
    expect(can("INVENTORY_MANAGER", "task.assign")).toBe(false);
  });

  it("FARRIER is specialist labour — shoeing visits only, no roster control", () => {
    // This test's own name always said "horse read, nothing else" while
    // asserting horse.manage === true. It didn't: horse.manage gates the whole
    // horse CRUD surface, so a visiting contractor could create and retire
    // horses on the club roster. Farriery is now its own permission.
    expect(can("FARRIER", "farriery.manage")).toBe(true);
    expect(can("FARRIER", "horse.manage")).toBe(false);
    expect(can("FARRIER", "task.complete")).toBe(true);
    expect(can("FARRIER", "leave.request")).toBe(true);
    expect(can("FARRIER", "task.assign")).toBe(false);
    expect(can("FARRIER", "asset.manage")).toBe(false);
    expect(can("FARRIER", "leave.approve")).toBe(false);
  });

  it("EXAMINER can score and issue certificates but not write riders", () => {
    expect(can("EXAMINER", "exam.score")).toBe(true);
    expect(can("EXAMINER", "certificate.issue")).toBe(true);
    expect(can("EXAMINER", "rider.read")).toBe(true);
    expect(can("EXAMINER", "rider.write")).toBe(false);
    expect(can("EXAMINER", "attendance.mark")).toBe(false);
  });

  it("VET handles medicines + horses + tasks; no rider write, no finance", () => {
    expect(can("VET", "medicine.manage")).toBe(true);
    expect(can("VET", "medicine.prescribe")).toBe(true);
    expect(can("VET", "horse.manage")).toBe(true);
    expect(can("VET", "task.complete")).toBe(true);
    expect(can("VET", "rider.write")).toBe(false);
    expect(can("VET", "finance.read")).toBe(false);
  });

  it("ACCOUNTANT covers finance only", () => {
    expect(can("ACCOUNTANT", "finance.read")).toBe(true);
    expect(can("ACCOUNTANT", "finance.write")).toBe(true);
    expect(can("ACCOUNTANT", "rider.write")).toBe(false);
    expect(can("ACCOUNTANT", "attendance.mark")).toBe(false);
  });

  it("RIDER has read-only rider access and nothing else", () => {
    expect(can("RIDER", "rider.read")).toBe(true);
    expect(can("RIDER", "rider.write")).toBe(false);
    expect(can("RIDER", "attendance.mark")).toBe(false);
    expect(can("RIDER", "finance.read")).toBe(false);
  });

  it("PARENT has rider.read only (route-level filter enforces parent-link)", () => {
    expect(can("PARENT", "rider.read")).toBe(true);
    expect(can("PARENT", "rider.write")).toBe(false);
    expect(can("PARENT", "attendance.mark")).toBe(false);
    expect(can("PARENT", "finance.read")).toBe(false);
    expect(can("PARENT", "leave.request")).toBe(false);
  });

  it("returns false for unknown role without throwing", () => {
    // @ts-expect-error — intentionally bad role
    expect(can("MARTIAN", "rider.read")).toBe(false);
  });
});

describe("requirePerm", () => {
  it("returns silently when permission granted", () => {
    expect(() => requirePerm("SUPER_ADMIN", "audit.read")).not.toThrow();
  });
  it("throws FORBIDDEN:<perm> when not granted", () => {
    expect(() => requirePerm("COACH", "finance.write")).toThrow("FORBIDDEN:finance.write");
  });
});

describe("permissionsFor", () => {
  it("returns the full permission array for a role", () => {
    const perms = permissionsFor("COACH");
    expect(perms).toEqual([
      "rider.read",
      "attendance.mark",
      "progress.write",
      "task.complete",
      "leave.request",
      "expense.submit",
      "requisition.submit",
      "lesson.write",
      "batch.manage",
      // A coach is usually first on the scene when a rider comes off, so they
      // close and annotate the injury record. Grooms, farriers, inventory and
      // the portal roles deliberately do NOT get this.
      "injury.manage",
    ]);
  });
  it("returns [] for unknown role", () => {
    // @ts-expect-error — intentionally bad role
    expect(permissionsFor("MARTIAN")).toEqual([]);
  });
});
