import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStudentDetail } from "@/lib/student";
import { blockIfFeatureOff } from "@/lib/features-gate";

// GET /api/student/me/detail — full detail (attendance, skills, exams, certs,
// notifications) for the signed-in rider.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "RIDER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "student-portal");
  if (featureBlock) return featureBlock;

  const detail = await getStudentDetail(session.userId);
  if (!detail) return NextResponse.json({ error: "NOT_LINKED" }, { status: 404 });
  return NextResponse.json(detail);
}
