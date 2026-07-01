import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForCentre, getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, maskAadhaar } from "@/lib/utils";
import { AssignBatch } from "./assign-batch";
import { ParentLinksPanel } from "./parent-links-panel";
import { RiderPortalPanel } from "./rider-portal-panel";
import { ActivityFeed } from "@/components/shell/activity-feed";
import { riderActivity } from "@/lib/activity";
import { AccreditationsPanel } from "./accreditations-panel";
import { can } from "@/lib/permissions";
import { isReadOnly } from "@/lib/roles";
import { bmiBand, bmiBandLabel, bmiBandTone, bmiNeedsAttention } from "@/lib/bmi";
import { loadRiderExamHistory } from "@/lib/exam-history";
import { ExamHistoryList } from "@/components/exams/exam-history-list";

export const dynamic = "force-dynamic";

function AttendanceSummary({ attendances }: { attendances: { status: string }[] }) {
  const total = attendances.length;
  if (total === 0) return null;
  const present = attendances.filter((a) => a.status === "present" || a.status === "late").length;
  const pct = Math.round((present / total) * 100);
  return (
    <Badge variant={pct >= 75 ? "success" : pct >= 60 ? "warning" : "destructive"}>
      {pct}% present-or-late ({present}/{total})
    </Badge>
  );
}

export default async function RiderProfile({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { id: true, name: true } },
      batch: { select: { name: true, startTime: true, endTime: true, dayOfWeek: true } },
      invoices: { orderBy: { createdAt: "desc" } },
      attendances: { orderBy: { date: "desc" }, take: 30 },
      parentLinks: {
        include: { parent: { select: { id: true, name: true, email: true, phone: true } } },
        orderBy: { createdAt: "asc" },
      },
      user: { select: { id: true, email: true } },
      accreditations: { orderBy: { issuedAt: "desc" } },
    },
  });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();
  // Org-ownership guard: HQ users (centreId=null) skip the centre check above,
  // so without this an HQ user from one org could open another org's rider by
  // id. Bound them to their own organisation.
  const [riderOrgId, sessionOrgId] = await Promise.all([
    getOrgIdForCentre(rider.centreId),
    getOrgIdForSession(session),
  ]);
  if (!sessionOrgId || riderOrgId !== sessionOrgId) notFound();

  const batches = await prisma.batch.findMany({
    where: { centreId: rider.centreId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Compute progress summary (skills mastered overall).
  const [allSkills, statuses, examHistory] = await Promise.all([
    prisma.skill.count({ where: { level: { centreId: rider.centreId } } }),
    prisma.riderSkillStatus.findMany({
      where: { riderId: rider.id },
      select: { status: true },
    }),
    loadRiderExamHistory(rider.id, rider.centreId, { take: 10 }),
  ]);
  const masteredCount = statuses.filter((s) => s.status === "mastered").length;
  const progressPct = allSkills > 0 ? Math.round((masteredCount / allSkills) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {rider.photoUrl ? (
            <img
              src={rider.photoUrl}
              alt={`${rider.firstName} ${rider.lastName}`}
              className="h-16 w-16 rounded-full border object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full border bg-muted text-2xl font-bold text-muted-foreground">
              {rider.firstName.charAt(0)}
              {rider.lastName.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">
              {rider.firstName} {rider.lastName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {rider.centre.name} · joined {formatDate(rider.joiningDate)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {can(session.role, "rider.write") && !isReadOnly(session.role) && (
            <a
              href={`/riders/${rider.id}/edit`}
              className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
              title="Edit personal info, contact, address, anthropometrics, medical notes"
            >
              Edit profile
            </a>
          )}
          <a
            href={`/riders/${rider.id}/analytics`}
            className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            View analytics
          </a>
          <a
            href={`/reports/${rider.id}`}
            className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Report card
          </a>
          <Badge variant={rider.status === "active" ? "success" : "warning"}>{rider.status.replace("_", " ")}</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">DOB</dt>
              <dd>{formatDate(rider.dob)}</dd>
              <dt className="text-muted-foreground">Gender</dt>
              <dd>{rider.gender ?? "—"}</dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd>{rider.mobile}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{rider.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Aadhaar</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono">{maskAadhaar(rider.aadhaarLast4)}</span>
                {rider.aadhaarDocUrl && (
                  <a
                    href={rider.aadhaarDocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border bg-card px-2 py-0.5 text-[10px] hover:bg-muted"
                  >
                    View scan
                  </a>
                )}
              </dd>
              <dt className="text-muted-foreground">Nationality</dt>
              <dd>{rider.nationality ?? "—"}</dd>
              <dt className="text-muted-foreground">School</dt>
              <dd>{rider.school ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address & Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Present</dt>
              <dd>{rider.addressPresent ?? "—"}</dd>
              <dt className="text-muted-foreground">Permanent</dt>
              <dd>{rider.addressPermanent ?? "—"}</dd>
              <dt className="text-muted-foreground">Pincode</dt>
              <dd>{rider.pincode ?? "—"}</dd>
              <dt className="text-muted-foreground">Father</dt>
              <dd>
                {rider.fatherName ?? "—"} {rider.fatherPhone && `· ${rider.fatherPhone}`}
              </dd>
              <dt className="text-muted-foreground">Mother</dt>
              <dd>
                {rider.motherName ?? "—"} {rider.motherPhone && `· ${rider.motherPhone}`}
              </dd>
              <dt className="text-muted-foreground">Emergency</dt>
              <dd>
                {rider.emergencyName ?? "—"} · {rider.emergencyPhone ?? "—"}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Riding & Medical</CardTitle>
              {/* AssignBatch is a write — read-only roles see the current
                  batch in the dl below but can't reassign. */}
              {!isReadOnly(session.role) && (
                <AssignBatch riderId={rider.id} currentBatchId={rider.batchId} batches={batches} />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Current level</dt>
              <dd>{rider.currentLevel ?? "—"}</dd>
              <dt className="text-muted-foreground">Batch</dt>
              <dd>{rider.batch ? `${rider.batch.name} (${rider.batch.startTime}–${rider.batch.endTime})` : "Unassigned"}</dd>
              <dt className="text-muted-foreground">Skills mastered</dt>
              <dd className="flex items-center gap-2">
                <a href={`/riders/${rider.id}/progress`} className="text-primary underline">
                  {masteredCount} / {allSkills}
                </a>
                <Badge variant={progressPct >= 80 ? "success" : progressPct >= 50 ? "warning" : "outline"}>
                  {progressPct}%
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Height / Weight</dt>
              <dd>
                {rider.heightCm ?? "—"} cm / {rider.weightKg ?? "—"} kg
              </dd>
              <dt className="text-muted-foreground">BMI</dt>
              <dd className="flex items-center gap-2">
                <span>{rider.bmi ?? "—"}</span>
                {/* BMI band badge — adult-band thresholds; see lib/bmi.ts
                    header for the caveat about minors. Only renders when
                    the band is outside normal — keeps the row visually
                    clean for healthy riders. */}
                {(() => {
                  const band = bmiBand(rider.bmi);
                  if (!bmiNeedsAttention(band)) return null;
                  const tone = bmiBandTone(band);
                  const variant = tone === "destructive" ? "destructive" : tone === "warning" ? "warning" : "outline";
                  return <Badge variant={variant} className="text-[10px]">{bmiBandLabel(band)}</Badge>;
                })()}
                {rider.bmiMeasuredAt && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (measured {formatDate(rider.bmiMeasuredAt)})
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">State rider ID</dt>
              <dd className="font-mono text-xs">{rider.stateRiderId ?? "—"}</dd>
              <dt className="text-muted-foreground">EFI rider ID</dt>
              <dd className="font-mono text-xs">{rider.efiRiderId ?? "—"}</dd>
              <dt className="text-muted-foreground">Medical</dt>
              <dd>{rider.medicalNotes ?? "—"}</dd>
              <dt className="text-muted-foreground">Allergies</dt>
              <dd>{rider.allergies ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parent Portal Access</CardTitle>
          </CardHeader>
          <CardContent>
            <ParentLinksPanel
              riderId={rider.id}
              canManage={!isReadOnly(session.role)}
              links={rider.parentLinks.map((l) => ({
                id: l.id,
                relationship: l.relationship,
                name: l.parent.name,
                email: l.parent.email,
                phone: l.parent.phone,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rider Portal Access</CardTitle>
          </CardHeader>
          <CardContent>
            <RiderPortalPanel
              riderId={rider.id}
              canManage={!isReadOnly(session.role)}
              currentUser={rider.user ? { id: rider.user.id, email: rider.user.email } : null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Indemnity</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Signed at</dt>
              <dd>{rider.indemnitySignedAt ? formatDate(rider.indemnitySignedAt) : "Not signed"}</dd>
              <dt className="text-muted-foreground">Signer IP</dt>
              <dd className="font-mono text-xs">{rider.indemnitySignerIp ?? "—"}</dd>
              <dt className="text-muted-foreground">User agent</dt>
              <dd className="font-mono text-xs truncate">{rider.indemnitySignerUa ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Attendance (Last 30)</CardTitle>
            <AttendanceSummary attendances={rider.attendances} />
          </div>
        </CardHeader>
        <CardContent>
          {rider.attendances.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {rider.attendances.map((a) => {
                const cls =
                  a.status === "present"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
                    : a.status === "absent"
                    ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30"
                    : a.status === "late"
                    ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
                    : "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30";
                return (
                  <div
                    key={a.id}
                    className={`rounded-md border px-2 py-1 text-xs ${cls}`}
                    title={`${a.date.toISOString().slice(0, 10)} · ${a.status}`}
                  >
                    {a.date.toISOString().slice(5, 10)} · {a.status[0].toUpperCase()}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exam History</CardTitle>
        </CardHeader>
        <CardContent>
          <ExamHistoryList exams={examHistory} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Kind</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Due</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rider.invoices.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.kind}</td>
                  <td className="py-2">₹{inv.amount.toLocaleString("en-IN")}</td>
                  <td className="py-2">{formatDate(inv.dueDate)}</td>
                  <td className="py-2">
                    <Badge
                      variant={inv.status === "paid" ? "success" : inv.status === "due" ? "warning" : "destructive"}
                    >
                      {inv.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {rider.invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </CardContent>
      </Card>

      <AccreditationsPanel
        riderId={rider.id}
        canManage={can(session.role, "accreditation.manage")}
        initial={rider.accreditations.map((a) => ({
          id: a.id,
          body: a.body,
          title: a.title,
          discipline: a.discipline,
          level: a.level,
          serialNo: a.serialNo,
          issuedAt: a.issuedAt.toISOString(),
          expiresAt: a.expiresAt?.toISOString() ?? null,
          fileUrl: a.fileUrl,
          status: a.status,
        }))}
      />

      <ActivityFeed items={await riderActivity(params.id)} title="Activity timeline" />
    </div>
  );
}
