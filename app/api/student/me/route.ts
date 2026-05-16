import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStudentSummary } from "@/lib/student";
import { blockIfFeatureOff } from "@/lib/features-gate";

// GET /api/student/me — summary for the signed-in rider's dashboard.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "RIDER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "student-portal");
  if (featureBlock) return featureBlock;

  const summary = await getStudentSummary(session.userId);
  if (!summary) return NextResponse.json({ error: "NOT_LINKED" }, { status: 404 });
  return NextResponse.json(summary);
}
