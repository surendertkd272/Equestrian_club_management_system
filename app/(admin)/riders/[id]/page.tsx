import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
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
import { formatEnum } from "@/lib/labels";
import { WithdrawPanel, WithdrawnRiderBanner } from "./withdraw-panel";
import { creditPosition } from "@/lib/credit-note";
import { InvoiceReversalActions, ReversePaymentButton } from "@/components/finance/reversal-actions";
import { RecordPaymentButton } from "@/components/finance/record-payment-button";
import { ConsentRecord } from "./consent-record";
import { PLATFORM_TZ } from "@/lib/tz";
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
  // Same role gate as the list — the detail page exposes the most PII (DOB,
  // contacts, Aadhaar doc), so enforce the /riders nav perm server-side.
  const session = await assertRoute("/riders");
  // Who sees the full consent evidence. HQ tier only: it carries a parent's IP
  // and device, which are needed for a dispute rather than for running a club.
  const isHqViewer = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const centreId = scopeCentre(session);

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    include: {
      // timezone: the consent record renders a legal timestamp, and the server
      // runs UTC — without it a 00:30 IST signature reads as the day before.
      centre: { select: { id: true, name: true, timezone: true } },
      batch: { select: { name: true, startTime: true, endTime: true, dayOfWeek: true } },
      invoices: {
        orderBy: { createdAt: "desc" },
        include: {
          payments: {
            select: { id: true, amount: true, method: true, paidAt: true, txnRef: true, reason: true, reversalOfId: true },
            orderBy: { paidAt: "desc" },
          },
          creditNotes: { select: { amount: true, gstAmount: true } },
        },
      },
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

  // What the family still owes, so off-boarding can state it rather than
  // leaving the operator to work it out on another screen. Voided invoices and
  // credit notes themselves are excluded; credits already issued are netted off
  // inside creditPosition.
  const outstanding = rider.invoices
    .filter((inv) => !inv.voidedAt && !inv.creditNoteForId)
    .reduce((t, inv) => t + creditPosition(inv).outstanding, 0);
  const canOffBoard = can(session.role, "rider.write") && !isReadOnly(session.role);

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
          {canOffBoard && (
            <WithdrawPanel
              riderId={rider.id}
              riderName={rider.firstName}
              status={rider.status}
              outstanding={outstanding}
              batchName={rider.batch?.name ?? null}
              canCancelDues={can(session.role, "finance.write")}
            />
          )}
          <Badge variant={rider.status === "active" ? "success" : rider.status === "withdrawn" ? "outline" : "warning"}>
            {formatEnum(rider.status)}
          </Badge>
        </div>
      </div>

      {rider.status === "withdrawn" && (
        <WithdrawnRiderBanner
          riderId={rider.id}
          riderName={rider.firstName}
          withdrawnAt={rider.withdrawnAt?.toISOString() ?? null}
          withdrawalReason={rider.withdrawalReason}
          lastDayAt={rider.lastDayAt?.toISOString() ?? null}
          outstanding={outstanding}
          canManage={canOffBoard}
        />
      )}

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
                    Front
                  </a>
                )}
                {rider.aadhaarBackDocUrl && (
                  <a
                    href={rider.aadhaarBackDocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border bg-card px-2 py-0.5 text-[10px] hover:bg-muted"
                  >
                    Back
                  </a>
                )}
              </dd>
              <dt className="text-muted-foreground">Nationality</dt>
              <dd>{rider.nationality ?? "—"}</dd>
              <dt className="text-muted-foreground">School</dt>
              <dd>{rider.school ?? "—"}</dd>
              <dt className="text-muted-foreground">Class / Section</dt>
              <dd>
                {rider.schoolClass || rider.schoolSection
                  ? `${rider.schoolClass ?? "—"} / ${rider.schoolSection ?? "—"}`
                  : "—"}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact Details</CardTitle>
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
              <dt className="text-muted-foreground">Current Level</dt>
              <dd>{rider.currentLevel ?? "—"}</dd>
              <dt className="text-muted-foreground">Batch</dt>
              <dd>{rider.batch ? `${rider.batch.name} (${rider.batch.startTime}–${rider.batch.endTime})` : "Unassigned"}</dd>
              <dt className="text-muted-foreground">Skills Mastered</dt>
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
              <dt className="text-muted-foreground">State Rider ID</dt>
              <dd className="font-mono text-xs">{rider.stateRiderId ?? "—"}</dd>
              <dt className="text-muted-foreground">EFI Rider ID</dt>
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

        {/* Non-HQ staff get the fact, not the evidence: whether a signature
            exists is operationally useful (don't let an unsigned rider mount),
            while the IP and device are a parent's personal data that only
            matter in a dispute. The full record is HQ-only, below. */}
        {!isHqViewer && (
          <Card>
            <CardHeader>
              <CardTitle>Indemnity</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Signed At</dt>
                <dd>
                  {rider.indemnitySignedAt ? formatDate(rider.indemnitySignedAt) : "Not signed"}
                </dd>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      {isHqViewer && (
        <ConsentRecord rider={rider} timeZone={rider.centre?.timezone ?? PLATFORM_TZ} />
      )}

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
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Kind</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Outstanding</th>
                <th className="pb-2">Due</th>
                <th className="pb-2">Status</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rider.invoices.map((inv) => {
                const pos = creditPosition(inv);
                const isCredit = !!inv.creditNoteForId;
                const received = inv.payments.reduce((t, p) => t + p.amount, 0);
                return (
                  <tr key={inv.id} className={`border-t ${inv.voidedAt ? "opacity-60" : ""}`}>
                    <td className="py-2">
                      {isCredit ? "Credit note" : formatEnum(inv.kind)}
                      {inv.voidedAt && (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-rose-600">void</span>
                      )}
                    </td>
                    <td className="py-2">₹{inv.amount.toLocaleString("en-IN")}</td>
                    <td className="py-2 font-mono text-xs">
                      {inv.voidedAt || isCredit ? "—" : `₹${Math.round(pos.outstanding).toLocaleString("en-IN")}`}
                    </td>
                    <td className="py-2">{formatDate(inv.dueDate)}</td>
                    <td className="py-2">
                      <Badge
                        variant={inv.status === "paid" ? "success" : inv.status === "due" ? "warning" : "destructive"}
                      >
                        {formatEnum(inv.status)}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {can(session.role, "finance.write") && (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {!inv.voidedAt && !isCredit && pos.outstanding > 0.001 && (
                            <RecordPaymentButton invoiceId={inv.id} outstanding={pos.outstanding} />
                          )}
                          <InvoiceReversalActions
                            invoiceId={inv.id}
                            outstanding={pos.outstanding}
                            received={received}
                            voided={!!inv.voidedAt}
                            isCreditNote={isCredit}
                          />
                          <a
                            href={`/finance/invoice/${inv.id}/print`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
                            title="Printable invoice"
                          >
                            Print
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rider.invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </CardContent>
      </Card>

      {(() => {
        // Receipts, with the way to undo one. This lives here because /finance
        // redirects to the dashboard — the rider profile is the only page an
        // operator can actually navigate to that knows about this family's money.
        const receipts = rider.invoices.flatMap((inv) =>
          inv.payments.map((p) => ({ ...p, invoiceKind: inv.kind })),
        );
        const reversed = new Set(receipts.map((p) => p.reversalOfId).filter((v): v is string => !!v));
        if (receipts.length === 0) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {receipts
                  .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
                  .map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                      <span>
                        {formatDate(p.paidAt)} · {formatEnum(p.method)}
                        {p.txnRef && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{p.txnRef}</span>
                        )}
                        {p.amount < 0 && (
                          <span className="ml-2 text-[11px] uppercase tracking-wide text-rose-600">
                            reversal{p.reason ? ` · ${p.reason}` : ""}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono">₹{Math.round(p.amount).toLocaleString("en-IN")}</span>
                        {can(session.role, "finance.write") && (
                          <ReversePaymentButton
                            paymentId={p.id}
                            amount={p.amount}
                            alreadyReversed={reversed.has(p.id)}
                          />
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        );
      })()}

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
