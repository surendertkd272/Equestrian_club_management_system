import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { levelLadder } from "@/lib/exam-booking";
import { LevelsEditor } from "./editor";

export const dynamic = "force-dynamic";

// Set the level riders already hold — returning riders, or riders joining
// from another club — for many riders at once.
export default async function RiderLevelsPage() {
  const session = await requireSession();
  if (!can(session.role, "exam.schedule")) redirect("/riders");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Set riders&rsquo; levels</CardTitle>
          <CardDescription>Levels belong to one centre. Pick the centre in the top bar first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if ((await getOrgIdForCentre(centreId)) !== orgId) redirect("/riders");

  const [riders, ladder] = await Promise.all([
    prisma.rider.findMany({
      where: { centreId, status: { notIn: ["withdrawn", "rejected", "cancelled"] } },
      select: {
        id: true, firstName: true, lastName: true, currentLevel: true, schoolClass: true,
        school: true, schoolRef: { select: { name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    levelLadder(prisma, centreId),
  ]);
  const levels = Array.from(ladder.byRank.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t.levelName);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/riders" className="text-xs text-muted-foreground hover:underline">
        ← Riders
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Set riders&rsquo; levels</CardTitle>
          <CardDescription>
            Record the level riders already hold — returning riders, or riders joining from another club — so exam
            bookings suggest the right next level. This issues no certificate; a pass on an exam day does that.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {levels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This centre has no levels yet.{" "}
              <Link href="/exams/templates" className="text-primary underline">
                Set up the level rubrics
              </Link>{" "}
              first.
            </p>
          ) : (
            <LevelsEditor
              levels={levels}
              riders={riders.map((r) => ({
                id: r.id,
                name: `${r.firstName} ${r.lastName}`,
                school: r.schoolRef?.name ?? r.school ?? "",
                schoolClass: r.schoolClass ?? "",
                level: r.currentLevel,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
