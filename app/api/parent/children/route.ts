import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParentChildren } from "@/lib/parent";
import { blockIfFeatureOff } from "@/lib/features-gate";

// GET /api/parent/children — list the signed-in parent's linked riders with summary stats.
// Parent-link enforcement is intrinsic: the query is scoped by parentUserId = session.userId.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "PARENT") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "parent-portal");
  if (featureBlock) return featureBlock;

  const children = await getParentChildren(session.userId);
  return NextResponse.json({ children });
}
