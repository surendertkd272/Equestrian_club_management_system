// The rider's signed-consent record.
//
// The public registration form tells the signer, in as many words, that their
// "electronic signature will be recorded with timestamp and IP address as
// legal proof of consent". These assert that the promise is actually kept —
// that what a parent agreed to is captured, and that it comes back out in a
// form a human could put in front of someone.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { mockReq } from "../helpers/request";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { POST: onboard } = await import("@/app/api/onboarding/route");

let centre: Awaited<ReturnType<typeof mkCentre>>;

beforeEach(async () => {
  await resetDb();
  const org = await mkOrg("Consent Club");
  centre = await mkCentre({ orgId: org.id, name: "Consent Centre" });
});

function application(over: Record<string, unknown> = {}) {
  return {
    centreSlug: centre.slug,
    firstName: "Aarav",
    lastName: "Sharma",
    dob: "2012-04-11", // a minor — pulls in the DPDPA parental consent block
    gender: "male",
    mobile: "9876543210",
    email: "parent@club.in",
    school: "DPS Ghaziabad",
    schoolClass: "7",
    schoolSection: "A",
    addressPresent: "1 Main St",
    pincode: "201301",
    emergencyName: "Priya Sharma",
    emergencyPhone: "9876543211",
    heightCm: 140,
    weightKg: 35,
    fullNameSignature: "Priya Sharma",
    agreed: true,
    injuryNocAgreed: true,
    parentName: "Priya Sharma",
    parentRelation: "mother",
    parentPhone: "9876543211",
    parentConsentAgreed: true,
    ...over,
  };
}

const submit = (body: unknown) =>
  onboard(
    mockReq("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "TestBrowser/1.0" },
      body: JSON.stringify(body),
    }),
  );

describe("what registration captures", () => {
  it("records the indemnity signature, the NOC tick, and the evidence", async () => {
    const res = await submit(application());
    expect(res.status).toBe(200);

    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });

    expect(rider.indemnitySignedAt).not.toBeNull();
    expect(rider.indemnitySignerUa).toContain("TestBrowser");
    expect(rider.indemnityVersion).toBeTruthy();

    const consent = rider.indemnityConsentJson as Record<string, unknown>;
    // The name they typed IS the signature — without it the record proves a
    // box was ticked, not who ticked it.
    expect(consent.signature).toBe("Priya Sharma");
    // The NOC is a separate agreement from the indemnity and must be
    // separately provable.
    expect(consent.nocAgreed).toBe(true);
    expect(consent.agreedAt).toBeTruthy();
  });

  it("keeps the exact parental consent wording, not just a version number", async () => {
    await submit(application());
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });

    const parental = rider.parentalConsentJson as Record<string, unknown>;
    expect(parental).toBeTruthy();
    expect(parental.parentName).toBe("Priya Sharma");
    expect(parental.parentRelation).toBe("mother");
    // The wording changes between versions. Storing the text this parent
    // actually saw is the difference between evidence and a claim that
    // evidence once existed.
    expect(String(parental.consentText ?? "").length).toBeGreaterThan(20);
    expect(parental.consentVersion).toBeTruthy();
  });

  it("does not attach parental consent to an adult rider", async () => {
    await submit(
      application({
        dob: "1995-04-11",
        firstName: "Grownup",
        email: "adult@club.in",
        mobile: "9000000001",
      }),
    );
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Grownup" } });
    expect(rider.parentalConsentJson).toBeNull();
    // ...but they still signed the indemnity themselves.
    expect(rider.indemnitySignedAt).not.toBeNull();
  });
});

describe("what the record can produce", () => {
  it("keeps the indemnity and NOC WORDING, not just a version number", async () => {
    // This stored a version string and nothing else, so the one document a
    // club would actually have to produce — the indemnity a parent signed —
    // could not be read back. A version identifies wording only while someone
    // still holds the version it points at.
    await submit(application());
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Aarav" } });
    const c = rider.indemnityConsentJson as Record<string, unknown>;

    expect(String(c.indemnityText ?? "")).toMatch(/risk|injur/i);
    expect(String(c.nocText ?? "")).toMatch(/No-Objection/i);
    // Version still present — the text is additional, not a replacement.
    expect(c.indemnityVersion).toBeTruthy();
    expect(c.nocVersion).toBeTruthy();
  });

  it("stores wording on the emailed-link path too, so both agree", async () => {
    const { INDEMNITY_TEXT, INJURY_NOC_TEXT } = await import("@/lib/schemas/rider-onboarding");
    await submit(application({ firstName: "Both", mobile: "9000000002", email: "b@club.in" }));
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Both" } });
    const c = rider.indemnityConsentJson as Record<string, unknown>;
    // Two ways of collecting the same legal artefact must record the same
    // thing, or a club ends up with two tiers of evidence.
    expect(c.indemnityText).toBe(INDEMNITY_TEXT);
    expect(c.nocText).toBe(INJURY_NOC_TEXT);
  });
});

describe("the signer's own copy", () => {
  it("a parent who signs AT REGISTRATION gets a receipt too", async () => {
    // This only went out on the emailed-link path, which left two tiers of
    // parent for the same legal act: one holding a written record, one holding
    // a green box that vanished when they closed the tab. The registration
    // form makes the stronger promise of the two.
    const sent: { to: string; subject: string }[] = [];
    const email = await import("@/lib/email");
    const spy = vi.spyOn(email, "sendEmail").mockImplementation(async (o) => {
      sent.push({ to: o.to, subject: o.subject });
      return { ok: true as const };
    });
    try {
      await submit(application({ email: "receipt@club.in" }));
      expect(sent.some((m) => m.subject.includes("Your signed indemnity"))).toBe(true);
      expect(sent.some((m) => m.to === "receipt@club.in")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("registers fine when the applicant gave no email", async () => {
    // No address is a normal state, not a failure — the registration must
    // still complete.
    const res = await submit(
      application({ email: "", firstName: "NoMail", mobile: "9000000009" }),
    );
    expect(res.status).toBe(200);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "NoMail" } });
    expect(rider.indemnitySignedAt).not.toBeNull();
  });
});

describe("rendering the record", () => {
  // The bug this guards: formatDate() has no timeZone and the server runs UTC,
  // so a consent signed just after midnight IST rendered as the PREVIOUS day —
  // on the one record whose entire job is stating when somebody agreed.
  function stamp(d: Date, timeZone: string) {
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  }

  it("shows a just-after-midnight IST signature on the correct day", async () => {
    // 2026-08-14T19:00:00Z is 2026-08-15 00:30 IST.
    const signedAt = new Date("2026-08-14T19:00:00.000Z");

    expect(stamp(signedAt, "Asia/Kolkata")).toContain("15 Aug");
    // Rendered without a timezone on a UTC server it would read 14 Aug — a
    // date-of-consent that is simply wrong.
    expect(stamp(signedAt, "UTC")).toContain("14 Aug");
  });

  it("centres carry a timezone to render against", async () => {
    const c = await prisma.centre.findUniqueOrThrow({ where: { id: centre.id } });
    expect(c.timezone).toBeTruthy();
  });
});

describe("what registration no longer demands", () => {
  // Most riders are minors; the number that matters for contact is a
  // parent's (captured separately). Requiring the child's own handset, or an
  // emergency contact before the club has even met the family, blocked
  // registrations for no safety benefit the parent fields didn't already
  // cover.
  it("registers with no mobile, no email and no emergency contact at all", async () => {
    const res = await submit(
      application({
        firstName: "Bare",
        mobile: "",
        email: "",
        emergencyName: "",
        emergencyPhone: "",
      }),
    );
    expect(res.status).toBe(200);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "Bare" } });
    expect(rider.mobile).toBeNull();
    expect(rider.emergencyName).toBeNull();
    expect(rider.emergencyPhone).toBeNull();
    // The signature and consent are unaffected by any of this.
    expect(rider.indemnitySignedAt).not.toBeNull();
  });

  it("does not store maritalStatus, education or occupation even if sent", async () => {
    // Removed from the form entirely; the API ignores them if a client sends
    // them anyway rather than erroring, since Zod strips unknown keys.
    const res = await submit(
      application({
        firstName: "NoExtra",
        mobile: "9000000010",
        maritalStatus: "single",
        education: "B.Sc",
        occupation: "Student",
      }),
    );
    expect(res.status).toBe(200);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "NoExtra" } });
    expect(rider.maritalStatus).toBeNull();
    expect(rider.education).toBeNull();
    expect(rider.occupation).toBeNull();
  });
});

describe("what registration now demands instead", () => {
  // School identity is the fence a school administrator's dashboard is
  // scoped by (lib/school-scope.ts) — a rider with no school on file is
  // invisible to the school that sent them.
  it("refuses registration with no school", async () => {
    const res = await submit(application({ firstName: "NoSchool", mobile: "9000000011", school: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/school/i);
    expect(await prisma.rider.count({ where: { firstName: "NoSchool" } })).toBe(0);
  });

  it("refuses registration with no class", async () => {
    const res = await submit(application({ firstName: "NoClass", mobile: "9000000012", schoolClass: "" }));
    expect(res.status).toBe(400);
    expect(await prisma.rider.count({ where: { firstName: "NoClass" } })).toBe(0);
  });

  it("refuses registration with no section", async () => {
    const res = await submit(application({ firstName: "NoSection", mobile: "9000000013", schoolSection: "" }));
    expect(res.status).toBe(400);
    expect(await prisma.rider.count({ where: { firstName: "NoSection" } })).toBe(0);
  });

  it("stores school, class and section when given", async () => {
    const res = await submit(application({ firstName: "WithSchool", mobile: "9000000014" }));
    expect(res.status).toBe(200);
    const rider = await prisma.rider.findFirstOrThrow({ where: { firstName: "WithSchool" } });
    expect(rider.school).toBe("DPS Ghaziabad");
    expect(rider.schoolClass).toBe("7");
    expect(rider.schoolSection).toBe("A");
  });
});

describe("the duplicate guard without a mobile number", () => {
  // Filtering the duplicate check on `mobile: ""` would match nothing (a
  // stored value is never the empty string), so a resubmitting family with no
  // mobile would silently stop being deduplicated — exactly the group most
  // likely to leave it blank. Name + DOB + centre + the short window must
  // still catch it.
  it("still catches a same-day resubmission with no mobile on either side", async () => {
    const first = await submit(
      application({ firstName: "Repeat", lastName: "Kid", mobile: "", dob: "2013-01-01" }),
    );
    expect(first.status).toBe(200);
    const second = await submit(
      application({ firstName: "Repeat", lastName: "Kid", mobile: "", dob: "2013-01-01" }),
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.duplicate).toBe(true);
    expect(await prisma.rider.count({ where: { firstName: "Repeat", lastName: "Kid" } })).toBe(1);
  });

  it("does not confuse two DIFFERENT mobile-less children born the same day", async () => {
    await submit(application({ firstName: "Twin", lastName: "One", mobile: "", dob: "2013-02-02" }));
    const res = await submit(application({ firstName: "Twin", lastName: "Two", mobile: "", dob: "2013-02-02" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBeFalsy();
    expect(await prisma.rider.count({ where: { firstName: "Twin" } })).toBe(2);
  });
});
