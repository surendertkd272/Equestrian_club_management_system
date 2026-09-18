import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
import { RIDER_STATUS } from "@/lib/rider-status";
import { schoolContext } from "@/lib/school-portal";
import { NoCentreCard } from "../../no-centre";

export const dynamic = "force-dynamic";

// One pupil, end to end.
//
// The portal could only ever answer questions about the whole roll. A school
// ringing the club about one child — how often has she actually ridden, did she
// pass, what is she working on — had to read across an aggregate table and
// count. This is that child's page.
//
// FENCE: fetched with the SAME riderWhere as every list, so the id in the URL
// cannot reach another school's child. A findUnique on the id followed by a
// check would work too; folding the fence into the query means there is no
// second condition to forget.
//
// Withheld here exactly as on the roll: no Aadhaar, no fees or invoices, no
// medical notes beyond allergies. A partner school is not the child's guardian.
//
// DO NOT add a loading.tsx above this route. A loading file makes the segment
// stream, which flushes the response headers before this component runs — so
// notFound() below can no longer set the status and a link to a pupil this
// account may not see answers 200 instead of 404. /school had one, which is
// exactly what it did; it was removed once these pages measured 11-22ms and
// the skeleton was buying almost nothing. tests/not-found-status.test.ts fails
// if it comes back — here or above any other page that calls notFound().

function ageOn(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export default async function SchoolRiderPage({ params }: { params: { id: string } }) {
  const ctx = await schoolContext();
  if (!ctx) return <NoCentreCard />;

  const rider = await prisma.rider.findFirst({
    where: { id: params.id, ...ctx.riderWhere },
    select: {
      id: true, firstName: true, lastName: true, dob: true, gender: true,
      schoolClass: true, schoolSection: true, currentLevel: true, joiningDate: true,
      status: true, heightCm: true, weightKg: true, bmi: true, allergies: true,
      batch: { select: { name: true, dayOfWeek: true, startTime: true, endTime: true, coachId: true } },
    },
  });
  if (!rider) notFound();

  const since = new Date(Date.now() - 180 * 86400000);
  const [attendance, exams, skills, coach] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId: rider.id, date: { gte: since } },
      orderBy: { date: "desc" },
      select: { id: true, date: true, status: true, reason: true },
    }),
    prisma.exam.findMany({
      where: { riderId: rider.id },
      orderBy: { date: "desc" },
      select: { id: true, level: true, date: true, status: true, totalScore: true, passed: true, attemptNumber: true },
    }),
    prisma.riderSkillStatus.findMany({
      where: { riderId: rider.id },
      orderBy: { updatedAt: "desc" },
      include: { skill: { select: { name: true, discipline: true } } },
    }),
    rider.batch?.coachId
      ? prisma.user.findUnique({ where: { id: rider.batch.coachId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const ATTENDED = new Set(["present", "late"]);
  const attended = attendance.filter((a) => ATTENDED.has(a.status)).length;
  const pct = attendance.length > 0 ? Math.round((attended / attendance.length) * 100) : null;
  const mastered = skills.filter((s) => s.status === "mastered").length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/school/riders"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Back to the roll
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {rider.firstName} {rider.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[rider.schoolClass, rider.schoolSection].filter(Boolean).join("-") || "Class not recorded"}
          {" · "}
          {ageOn(rider.dob)} years old · joined {formatDate(rider.joiningDate)}
        </p>
      </div>

      {rider.status === RIDER_STATUS.PENDING_CONSENT && (
        <Card className="border-l-4 border-l-rose-500">
          <CardHeader>
            <CardTitle className="text-base">Cannot Ride Yet — Consent Not Signed</CardTitle>
            <CardDescription>
              A parent still needs to sign the indemnity and injury NOC. This student goes active
              automatically the moment it&apos;s signed.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Attendance (6 Months)" value={pct === null ? "—" : `${pct}%`}
              sub={attendance.length > 0 ? `${attended} of ${attendance.length} sessions` : "no sessions yet"} />
        <Stat label="Current Level" value={rider.currentLevel ?? "—"}
              sub={rider.batch ? rider.batch.name : "no batch yet"} />
        <Stat label="Skills Mastered" value={String(mastered)}
              sub={skills.length > 0 ? `of ${skills.length} tracked` : "none tracked yet"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Batch" value={rider.batch ? `${rider.batch.name} · ${rider.batch.dayOfWeek} ${rider.batch.startTime}–${rider.batch.endTime}` : "—"} />
            <Row label="Coach" value={coach?.name ?? "—"} />
            <Row label="Height / Weight / BMI" value={rider.heightCm || rider.weightKg
              ? `${rider.heightCm ?? "–"}cm / ${rider.weightKg ?? "–"}kg${rider.bmi ? ` / ${rider.bmi.toFixed(1)}` : ""}`
              : "—"} />
            <Row label="Allergies" value={rider.allergies ?? "None recorded"}
                 warn={Boolean(rider.allergies)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exams</CardTitle>
        </CardHeader>
        <CardContent>
          {exams.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No exams yet.</p>
          ) : (
            <ul className="space-y-1">
              {exams.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
                  <span>
                    <span className="font-medium">Level {e.level}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatDate(e.date)}
                      {e.attemptNumber > 1 ? ` · attempt ${e.attemptNumber}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {e.totalScore !== null && (
                      <span className="font-mono text-sm">{e.totalScore.toFixed(1)}</span>
                    )}
                    {e.passed === true ? (
                      <Badge variant="success">Passed</Badge>
                    ) : e.passed === false ? (
                      <Badge variant="destructive">Not yet</Badge>
                    ) : (
                      <Badge variant="outline">{formatEnum(e.status)}</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skills</CardTitle>
        </CardHeader>
        <CardContent>
          {skills.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No skills logged for this student yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {skills.map((s) => (
                <li key={s.skillId} className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                  <span className="min-w-0">
                    <span className="font-medium">{s.skill.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.skill.discipline}</span>
                  </span>
                  <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                    {formatDate(s.updatedAt)}
                  </span>
                  <Badge variant={s.status === "mastered" ? "success" : s.status === "in_progress" ? "warning" : "outline"}>
                    {formatEnum(s.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance (Last 6 Months)</CardTitle>
          <CardDescription>
            Most recent first. Turning up late still counts as attending; excused absences count
            as a session offered but not attended.
          </CardDescription>
          {/* The colours carried the meaning and only a hover title explained
              them, which is no explanation at all on a phone. */}
          {attendance.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden /> Present
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden /> Late
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-rose-500" aria-hidden /> Absent or excused
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No sessions recorded in the last six months.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {attendance.map((a) => (
                <li
                  key={a.id}
                  title={`${formatDate(a.date)} — ${formatEnum(a.status)}${a.reason ? ` (${a.reason})` : ""}`}
                  // The chip shows only a date, so the status has to reach a
                  // screen reader some other way than the colour.
                  aria-label={`${formatDate(a.date)}: ${formatEnum(a.status)}`}
                  className={
                    "rounded-md border px-2 py-1 text-xs " +
                    (a.status === "present"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                      : a.status === "late"
                        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200")
                  }
                >
                  {formatDate(a.date)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={warn ? "text-amber-700 dark:text-amber-400" : ""}>{value}</dd>
    </div>
  );
}
