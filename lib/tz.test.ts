import { describe, it, expect } from "vitest";
import { startOfDayInTz, endOfDayInTz, sameLocalDay, parseWallTimeInTz } from "./tz";

const IST = "Asia/Kolkata"; // +05:30, no DST

describe("tz day boundaries (IST)", () => {
  it("IST midnight maps to 18:30 UTC the previous day", () => {
    // 2026-06-01T20:00Z is 2026-06-02T01:30 IST → its IST day starts at
    // 2026-06-02T00:00 IST = 2026-06-01T18:30Z.
    const at = new Date("2026-06-01T20:00:00.000Z");
    expect(startOfDayInTz(at, IST).toISOString()).toBe("2026-06-01T18:30:00.000Z");
    expect(endOfDayInTz(at, IST).toISOString()).toBe("2026-06-02T18:29:59.999Z");
  });

  it("groups late-evening-IST instants into the correct local day (the UTC bug)", () => {
    // Both are the evening of June 1 IST, but straddle the UTC midnight:
    //   23:00 IST June 1 = 17:30Z June 1
    //   23:00 IST + ... actually use one before and one after UTC midnight.
    const a = new Date("2026-06-01T18:00:00.000Z"); // 23:30 IST June 1
    const b = new Date("2026-06-01T19:00:00.000Z"); // 00:30 IST June 2
    // Same UTC day (June 1) but DIFFERENT IST days.
    expect(a.getUTCDate()).toBe(b.getUTCDate());
    expect(sameLocalDay(a, b, IST)).toBe(false);
  });

  it("groups instants that share an IST day even across UTC midnight", () => {
    // 20:00Z June 1 = 01:30 IST June 2; 02:00Z June 2 = 07:30 IST June 2.
    const a = new Date("2026-06-01T20:00:00.000Z");
    const b = new Date("2026-06-02T02:00:00.000Z");
    expect(a.getUTCDate()).not.toBe(b.getUTCDate()); // different UTC days
    expect(sameLocalDay(a, b, IST)).toBe(true); // same IST day
  });
});

describe("parseWallTimeInTz", () => {
  it("parses a zoneless local datetime against the centre zone (6 AM IST = 00:30 UTC)", () => {
    expect(parseWallTimeInTz("2026-06-18T06:00", IST).toISOString()).toBe("2026-06-18T00:30:00.000Z");
  });
  it("treats a date-only string as local midnight (18 Jun 00:00 IST = 17 Jun 18:30 UTC)", () => {
    expect(parseWallTimeInTz("2026-06-18", IST).toISOString()).toBe("2026-06-17T18:30:00.000Z");
  });
  it("respects an explicit zone in the string", () => {
    expect(parseWallTimeInTz("2026-06-18T06:00:00Z", IST).toISOString()).toBe("2026-06-18T06:00:00.000Z");
  });
  it("is identity for the UTC zone", () => {
    expect(parseWallTimeInTz("2026-06-18T06:00", "UTC").toISOString()).toBe("2026-06-18T06:00:00.000Z");
  });
});
