import { describe, it, expect } from "vitest";
import { creditPosition } from "./credit-note";
import { updateBatchSchema } from "./schemas/batch";

// Two paths issue credit notes — the manual one on an invoice, and rider
// withdrawal cancelling everything a departing family still owes. Both read
// their numbers from creditPosition, so the arithmetic is pinned here.
describe("creditPosition", () => {
  const inv = (over: Partial<Parameters<typeof creditPosition>[0]> = {}) => ({
    amount: 10_000,
    gstAmount: 1_800,
    payments: [],
    creditNotes: [],
    ...over,
  });

  it("an untouched invoice is outstanding in full", () => {
    const p = creditPosition(inv());
    expect(p.face).toBe(11_800);
    expect(p.creditable).toBe(11_800);
    expect(p.received).toBe(0);
    expect(p.outstanding).toBe(11_800);
  });

  it("part payment reduces what is outstanding but not what is creditable", () => {
    const p = creditPosition(inv({ payments: [{ amount: 5_000 }] }));
    expect(p.received).toBe(5_000);
    expect(p.outstanding).toBe(6_800);
    // The club may still credit the whole invoice — that's a refund, and it's
    // allowed; it just isn't the default.
    expect(p.creditable).toBe(11_800);
  });

  it("a reversed payment stops counting as received", () => {
    // Reversals are negative rows against the same invoice (bounced cheque).
    const p = creditPosition(inv({ payments: [{ amount: 5_000 }, { amount: -5_000 }] }));
    expect(p.received).toBe(0);
    expect(p.outstanding).toBe(11_800);
  });

  it("credits already issued come off the ceiling", () => {
    const p = creditPosition(inv({ creditNotes: [{ amount: -4_000, gstAmount: -720 }] }));
    expect(p.creditable).toBe(11_800 - 4_720);
    expect(p.outstanding).toBe(7_080);
  });

  it("never reports a negative outstanding when a family has overpaid", () => {
    const p = creditPosition(inv({ payments: [{ amount: 15_000 }] }));
    expect(p.outstanding).toBe(0);
  });

  it("a fully credited invoice has nothing left to credit", () => {
    const p = creditPosition(inv({ creditNotes: [{ amount: -10_000, gstAmount: -1_800 }] }));
    expect(p.creditable).toBe(0);
    expect(p.outstanding).toBe(0);
  });

  it("handles a zero-GST invoice without dividing by zero", () => {
    const p = creditPosition(inv({ amount: 5_000, gstAmount: 0, payments: [{ amount: 1_000 }] }));
    expect(p.face).toBe(5_000);
    expect(p.outstanding).toBe(4_000);
  });
});

// A batch had no update route at all until now; these are the rules that stop
// an edit corrupting a live timetable.
describe("updateBatchSchema", () => {
  it("accepts a single field — you can move the time without restating the rest", () => {
    expect(updateBatchSchema.safeParse({ startTime: "06:30" }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(updateBatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed time", () => {
    expect(updateBatchSchema.safeParse({ startTime: "6:30" }).success).toBe(false);
    expect(updateBatchSchema.safeParse({ endTime: "25:00" }).success).toBe(false);
  });

  it("rejects invented day codes but takes a valid CSV", () => {
    expect(updateBatchSchema.safeParse({ dayOfWeek: "Mondayish" }).success).toBe(false);
    expect(updateBatchSchema.safeParse({ dayOfWeek: "Mon,Wed,Fri" }).success).toBe(true);
  });

  it("allows clearing the coach and the level", () => {
    expect(updateBatchSchema.safeParse({ coachId: null }).success).toBe(true);
    expect(updateBatchSchema.safeParse({ level: null }).success).toBe(true);
    // An empty string is not a coach id — that's a form bug, not "unassign".
    expect(updateBatchSchema.safeParse({ coachId: "" }).success).toBe(false);
  });
});
