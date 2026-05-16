import { describe, it, expect } from "vitest";
import { normalizeIndianPhone } from "./sms";

describe("normalizeIndianPhone", () => {
  it("accepts 10-digit local numbers, adds +91", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("+919876543210");
  });
  it("accepts 12-digit numbers starting with 91", () => {
    expect(normalizeIndianPhone("919876543210")).toBe("+919876543210");
  });
  it("accepts E.164 +91… as-is", () => {
    expect(normalizeIndianPhone("+919876543210")).toBe("+919876543210");
  });
  it("strips leading 0 from 11-digit STD format", () => {
    expect(normalizeIndianPhone("09876543210")).toBe("+919876543210");
  });
  it("strips spaces, dashes, parens before matching", () => {
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeIndianPhone("(987) 654-3210")).toBe("+919876543210");
  });
  it("rejects null / undefined / empty", () => {
    expect(normalizeIndianPhone(null)).toBeNull();
    expect(normalizeIndianPhone(undefined)).toBeNull();
    expect(normalizeIndianPhone("")).toBeNull();
  });
  it("rejects junk that doesn't match any pattern", () => {
    expect(normalizeIndianPhone("12345")).toBeNull(); // too short
    expect(normalizeIndianPhone("1234567890123")).toBeNull(); // 13 digits, no rule
    expect(normalizeIndianPhone("821234567890")).toBeNull(); // 12 digits, wrong cc
  });
});
