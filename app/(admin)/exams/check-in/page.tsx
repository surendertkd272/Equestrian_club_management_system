import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { sittingLabel } from "@/lib/exam-labels";
import { CheckInList } from "./check-in-list";

export const dynamic = "force-dynamic";

// The gate: tick riders in as they arrive, in running order, on a phone.
export default async function CheckInPage({ searchParams }: { searchParams: { day?: string; sitting?: string } }) {
  const session = await requireSession();
  const where = searchParams.day ? { examDayId: searchParams.day } : searchParams.sitting ? { id: searchParams.sitting } : null;
  if (!where) redirect("/exams");
  const sittings = await prisma.examSitting.findMany({
    where,
    orderBy: [{ level: "asc" }, { groupNo: "asc" }],
    include: {
      examDay: { select: { name: true } },
      examiners: { select: { examinerId: true } },
      exams: {
        where: { status: { in: ["scheduled", "in_progress", "absent"] } },
        orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }, { rider: { firstName: "asc" } }],
        select: {
          id: true, time: true, runOrder: true, status: true, checkedInAt: true,
          rider: { select: { firstName: true, lastName: true, school: true, schoolRef: { select: { name: true } } } },
        },
      },
    },
  });
  if (sittings.length === 0) notFound();
  if (await centreFence(session, sittings[0].centreId)) notFound();
  const inPool = sittings.some((s) => s.examiners.some((x) => x.examinerId === session.userId));
  if (!can(session.role, "exam.schedule") && !(session.role === "EXAMINER" && inPool)) redirect("/exams");
  const templates = await prisma.scoringTemplate.findMany({ where: { centreId: sittings[0].centreId }, select: { levelKey: true, levelName: true } });
  const levelName = (n: number) => templates.find((t) => t.levelKey === String(n))?.levelName ?? `Level ${n}`;
  const rows = sittings.flatMap((s) =>
    s.exams.map((e) => ({
      id: e.id,
      group: sittingLabel(levelName(s.level), s.groupNo),
      time: s.slotMinutes ? e.time : null,
      order: e.runOrder,
      name: `${e.rider.firstName} ${e.rider.lastName}`,
      school: e.rider.schoolRef?.name ?? e.rider.school ?? "",
      state: e.status === "absent" ? ("absent" as const) : e.status === "in_progress" ? ("riding" as const) : e.checkedInAt ? ("here" as const) : ("expected" as const),
    })),
  );
  const back = searchParams.day ? `/exams/days/${searchParams.day}` : `/exams/sittings/${searchParams.sitting}`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={back} className="text-xs text-muted-foreground hover:underline">
        ← Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Check-in</h1>
        <p className="text-sm text-muted-foreground">
          {sittings[0].examDay?.name ?? sittingLabel(levelName(sittings[0].level), sittings[0].groupNo)} · {formatDate(sittings[0].date)}
        </p>
      </div>
      <CheckInList rows={rows} />
    </div>
  );
}
