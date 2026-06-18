// Audit-3: facility bookings stored the wall-clock in server-UTC instead of the
// centre's zone (same class as the #132 horse-allocation fix). A 2 PM IST slot
// became 2 PM UTC (= 7:30 PM IST). The POST now parses the zoneless datetime in
// the facility's centre timezone.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => cookieJar.get(n),
    set: (n: string, v: string) => cookieJar.set(n, { value: v }),
    delete: (n: string) => cookieJar.delete(n),
  }),
}));

const { POST: bookingPost } = await import("@/app/api/facility-bookings/route");

async function login(u: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = { userId: u.id, role: u.role as Role, centreId: u.centreId, name: u.name, tokenVersion: 0 };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
});

describe("facility booking stores wall-clock in the centre timezone", () => {
  it("parses a zoneless datetime against the centre zone (IST), not server UTC", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id }); // default timezone Asia/Kolkata (+05:30)
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Mgr" });
    const facility = await prisma.facility.create({ data: { centreId: centre.id, name: "Indoor Arena", type: "indoor_arena" } });

    await login(mgr);
    const res = await bookingPost(mockReq("http://localhost/api/facility-bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId: facility.id, purpose: "lesson", title: "Afternoon lesson", startAt: "2026-06-15T14:00", endAt: "2026-06-15T16:00" }),
    }));
    expect(res.status).toBe(200);

    const row = await prisma.facilityBooking.findFirstOrThrow({ where: { facilityId: facility.id } });
    // 14:00 IST = 08:30 UTC; 16:00 IST = 10:30 UTC.
    expect(row.startAt.toISOString()).toBe("2026-06-15T08:30:00.000Z");
    expect(row.endAt.toISOString()).toBe("2026-06-15T10:30:00.000Z");
  });
});
