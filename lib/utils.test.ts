import { describe, it, expect } from "vitest";
import { cn, calcBmi, formatDate, maskAadhaar } from "./utils";

describe("cn", () => {
  it("merges tailwind class strings", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
  it("drops falsy values", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });
  it("merges conflicting tailwind utilities, last wins", () => {
    expect(cn("text-sm text-red-500", "text-blue-500")).toBe("text-sm text-blue-500");
  });
});

describe("calcBmi", () => {
  it("returns BMI rounded to 1 decimal", () => {
    // 1.7m, 70kg → 70 / 2.89 = 24.221… → 24.2
    expect(calcBmi(170, 70)).toBe(24.2);
  });
  it("returns null when height is missing", () => {
    expect(calcBmi(null, 70)).toBeNull();
    expect(calcBmi(undefined, 70)).toBeNull();
    expect(calcBmi(0, 70)).toBeNull();
  });
  it("returns null when weight is missing", () => {
    expect(calcBmi(170, null)).toBeNull();
    expect(calcBmi(170, 0)).toBeNull();
  });
  it("rejects negative height", () => {
    expect(calcBmi(-170, 70)).toBeNull();
  });
});

describe("formatDate", () => {
  it("returns em-dash for null/undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
  it("formats Date instances in en-IN style", () => {
    // UTC midpoint avoids tz-induced day shifts on the test runner.
    const d = new Date("2026-05-14T12:00:00.000Z");
    const out = formatDate(d);
    expect(out).toMatch(/^14 May 2026$/);
  });
  it("accepts ISO strings", () => {
    expect(formatDate("2026-05-14T12:00:00.000Z")).toMatch(/^14 May 2026$/);
  });
});

describe("maskAadhaar", () => {
  it("masks all but last 4 digits", () => {
    expect(maskAadhaar("123456789012")).toBe("XXXX XXXX 9012");
  });
  it("strips non-digits before masking", () => {
    expect(maskAadhaar("1234 5678 9012")).toBe("XXXX XXXX 9012");
    expect(maskAadhaar("1234-5678-9012")).toBe("XXXX XXXX 9012");
  });
  it("returns em-dash for empty/nullish input", () => {
    expect(maskAadhaar(null)).toBe("—");
    expect(maskAadhaar(undefined)).toBe("—");
    expect(maskAadhaar("")).toBe("—");
  });
  it("returns fully-masked placeholder for too-short input", () => {
    expect(maskAadhaar("123")).toBe("XXXX XXXX XXXX");
  });
});
