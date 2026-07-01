import { describe, it, expect } from "vitest";
import { formatEnum, roleLabel, titleCase } from "@/lib/labels";

describe("formatEnum", () => {
  it("capitalises simple statuses", () => {
    expect(formatEnum("active")).toBe("Active");
    expect(formatEnum("suspended")).toBe("Suspended");
    expect(formatEnum("pending")).toBe("Pending");
  });

  it("splits underscores and title-cases, lowercasing minor words", () => {
    expect(formatEnum("past_due")).toBe("Past Due");
    expect(formatEnum("half_day")).toBe("Half Day");
    expect(formatEnum("out_of_stock")).toBe("Out of Stock");
    expect(formatEnum("resignation_request")).toBe("Resignation Request");
  });

  it("keeps hyphenated compounds capitalised on both sides", () => {
    expect(formatEnum("no-show")).toBe("No-Show");
  });

  it("preserves acronyms and brands", () => {
    expect(formatEnum("upi")).toBe("UPI");
    expect(formatEnum("efi")).toBe("EFI");
    expect(formatEnum("bank_neft")).toBe("Bank NEFT");
  });

  it("is safe on empty / nullish input", () => {
    expect(formatEnum("")).toBe("");
    expect(formatEnum(null)).toBe("");
    expect(formatEnum(undefined)).toBe("");
  });

  it("does not mutate an already-formatted value (idempotent)", () => {
    expect(formatEnum(formatEnum("past_due"))).toBe("Past Due");
  });
});

describe("roleLabel", () => {
  it("title-cases UPPER_SNAKE role tokens", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super Admin");
    expect(roleLabel("INVENTORY_MANAGER")).toBe("Inventory Manager");
    expect(roleLabel("SCHOOL_ADMINISTRATOR")).toBe("School Administrator");
    expect(roleLabel("VET")).toBe("Vet");
    expect(roleLabel("HEAD_COACH")).toBe("Head Coach");
  });
});

describe("titleCase", () => {
  it("lowercases minor words in the middle only", () => {
    expect(titleCase("time off")).toBe("Time Off");
    expect(titleCase("out of stock")).toBe("Out of Stock");
  });
});
