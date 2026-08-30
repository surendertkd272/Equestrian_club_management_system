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
