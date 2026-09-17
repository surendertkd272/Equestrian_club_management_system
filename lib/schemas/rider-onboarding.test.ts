import { describe, it, expect } from "vitest";
import { personalSchema, parentsSchema, onboardingSchema } from "./rider-onboarding";

const fullPersonal = {
  firstName: "Riya",
  lastName: "Test",
  dob: "2014-05-14",
  gender: "female" as const,
  school: "DPS Noida",
  schoolClass: "7",
  schoolSection: "A",
};

describe("personalSchema — school is now required", () => {
  // School identity is the fence a school administrator's whole view is
  // scoped by (lib/school-scope.ts). A rider with no school on file is
  // invisible to the school that sent them.
  it("rejects when school is omitted", () => {
    const { school, ...rest } = fullPersonal;
    const r = personalSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects an empty school string", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, school: "" });
    expect(r.success).toBe(false);
  });

  it("rejects when schoolClass is omitted", () => {
    const { schoolClass, ...rest } = fullPersonal;
    const r = personalSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects when schoolSection is omitted", () => {
    const { schoolSection, ...rest } = fullPersonal;
    const r = personalSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("accepts a real school, class and section", () => {
    const r = personalSchema.safeParse(fullPersonal);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.school).toBe("DPS Noida");
      expect(r.data.schoolClass).toBe("7");
      expect(r.data.schoolSection).toBe("A");
    }
  });

  it("rejects a school name longer than 150 chars", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, school: "x".repeat(151) });
    expect(r.success).toBe(false);
  });
});

describe("personalSchema — mobile is now optional", () => {
  // Most riders are minors; the number that matters for contact is a
  // parent's, asked for separately. Requiring the child's own handset
  // blocked a family with none for their kid.
  it("accepts registration with no mobile at all", () => {
    const r = personalSchema.safeParse(fullPersonal);
    expect(r.success).toBe(true);
  });

  it("accepts an empty-string mobile", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, mobile: "" });
    expect(r.success).toBe(true);
  });

  it("still validates a mobile that IS given", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, mobile: "not-a-number" });
    expect(r.success).toBe(false);
  });

  it("accepts and normalises a real mobile", () => {
    const r = personalSchema.safeParse({ ...fullPersonal, mobile: "+91 98765 43210" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mobile).toBe("9876543210");
  });
});

describe("personalSchema — maritalStatus, education, occupation are gone", () => {
  // Removed from the registration link entirely, not merely left optional.
  // Zod strips unknown keys by default, so submitting them is harmless but
  // they never reach the parsed output.
  it("does not surface these keys even when submitted", () => {
    const r = personalSchema.safeParse({
      ...fullPersonal,
      maritalStatus: "single",
      education: "B.Sc",
      occupation: "Student",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).maritalStatus).toBeUndefined();
      expect((r.data as Record<string, unknown>).education).toBeUndefined();
      expect((r.data as Record<string, unknown>).occupation).toBeUndefined();
    }
  });
});

describe("parentsSchema — emergency contact is now optional", () => {
  // A club can register a rider before an emergency contact is known and
  // add it to the profile once it's collected.
  it("accepts an empty parents step", () => {
    const r = parentsSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("still validates an emergency phone that IS given", () => {
    const r = parentsSchema.safeParse({ emergencyPhone: "not-a-number" });
    expect(r.success).toBe(false);
  });

  it("accepts a real emergency contact when supplied", () => {
    const r = parentsSchema.safeParse({ emergencyName: "Priya Sharma", emergencyPhone: "9876543210" });
    expect(r.success).toBe(true);
  });
});

describe("onboardingSchema — the full merged form", () => {
  function merged(over: Record<string, unknown> = {}) {
    return onboardingSchema.safeParse({
      ...fullPersonal,
      addressPresent: "1 Main St",
      pincode: "201301",
      heightCm: 140,
      weightKg: 35,
      fullNameSignature: "Riya Test",
      agreed: true,
      injuryNocAgreed: true,
      centreSlug: "ghrc",
      ...over,
    });
  }

  it("submits with no mobile, no email and no emergency contact", () => {
    const r = merged();
    expect(r.success).toBe(true);
  });

  it("still refuses with no school", () => {
    const r = onboardingSchema.safeParse({
      firstName: "Riya",
      lastName: "Test",
      dob: "2014-05-14",
      gender: "female",
      schoolClass: "7",
      schoolSection: "A",
      addressPresent: "1 Main St",
      pincode: "201301",
      fullNameSignature: "Riya Test",
      agreed: true,
      injuryNocAgreed: true,
      centreSlug: "ghrc",
    });
    expect(r.success).toBe(false);
  });

  it("the merged schema preserves school, class and section", () => {
    const r = merged();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.school).toBe("DPS Noida");
      expect(r.data.schoolClass).toBe("7");
      expect(r.data.schoolSection).toBe("A");
    }
  });
});
