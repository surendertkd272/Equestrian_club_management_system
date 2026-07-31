// Public submit for the reusable per-club vendor registration link
// (/onboard/vendor?centre=<slug>). Creates a Vendor row as status="pending" +
// active=false, so it stays out of the working vendor list + expense pickers
// until an admin approves it on /vendors. Mirrors the rider/staff public flows:
// bindRlsBypass (no session), IP rate-limit, resolve centre by slug, notify.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyCentreManager } from "@/lib/notify";
import { publicVendorRegistrationSchema } from "@/lib/schemas/vendor";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { bindRlsBypass } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  bindRlsBypass(); // public flow — no session to bind an org from
  const rl = await checkRate(`vendor-register:${clientFingerprint(req)}`, 10, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = publicVendorRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const centre = await prisma.centre.findUnique({ where: { slug: d.centreSlug }, select: { id: true } });
  if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });

  const vendor = await prisma.vendor.create({
    data: {
      centreId: centre.id,
      name: d.name,
      category: d.category ?? "other",
      contactName: d.contactName ?? null,
      phone: d.phone,
      email: d.email ?? null,
      address: d.address ?? null,
      gstin: d.gstin ?? null,
      notes: d.notes ?? null,
      status: "pending", // awaiting admin review
      active: false, // hidden from the working list until approved
    },
  });

  await notifyCentreManager(centre.id, {
    type: "vendor.registered",
    title: `New vendor registration — ${d.name}`,
    body: "A vendor registered via the public club link. Review and approve to add them.",
    link: "/vendors",
    payload: { vendorId: vendor.id },
  });

  return NextResponse.json({ ok: true });
}
