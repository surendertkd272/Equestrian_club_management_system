import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getChildDetail } from "@/lib/parent";
import { blockIfFeatureOff } from "@/lib/features-gate";

// GET /api/parent/children/[riderId] — detailed view of one of the parent's children.
// 404 if the rider isn't linked to this parent (avoids leaking existence of unrelated riders).
export async function GET(_req: NextRequest, { params }: { params: { riderId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "PARENT") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "parent-portal");
  if (featureBlock) return featureBlock;

  const detail = await getChildDetail(session.userId, params.riderId);
  if (!detail) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail);
}
