import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/owner-auth";
import { ensurePricingRows } from "@/lib/pricing";

// GET /api/owner/pricing — list all three rows (seeded on first read).
// Read-only; PATCH on /api/owner/pricing/[key] does the edits.
export async function GET() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const rows = await ensurePricingRows();
  return NextResponse.json({ rows });
}
