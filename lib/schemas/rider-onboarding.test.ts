import { describe, it, expect } from "vitest";
import { personalSchema, onboardingSchema } from "./rider-onboarding";

const fullPersonal = {
  firstName: "Riya",
  lastName: "Test",
  dob: "2014-05-14",
  gender: "female" as const,
  mobile: "9876543210",
};

describe("personalSchema — school", () => {
  it("accepts an optional school name", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, school: "DPS Noida" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.school).toBe("DPS Noida");
  });

  it("is fine when school is omitted (it's optional)", () => {
    const r = personalSchema.safeParse(fullPersonal);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.school).toBeUndefined();
  });

  it("rejects strings longer than 150 chars", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, school: "x".repeat(151) });
    expect(r.success).toBe(false);
  });
});

describe("onboardingSchema — school flows through", () => {
  it("the merged schema preserves the school field", () => {
    const r = onboardingSchema.safeParse({
      ...fullPersonal,
      school: "Modern School",
      addressPresent: "1 Main St",
      pincode: "201301",
      emergencyName: "EC",
      emergencyPhone: "9876500000",
      heightCm: 140,
      weightKg: 35,
      fullNameSignature: "Riya Test",
      agreed: true,
      centreSlug: "ghrc",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.school).toBe("Modern School");
  });
});
