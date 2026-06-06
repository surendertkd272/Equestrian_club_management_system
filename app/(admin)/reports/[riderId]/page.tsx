import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { PeriodForm } from "./period-form";

export const dynamic = "force-dynamic";

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return new Date(s + "T00:00:00.000Z");
}

export default async function ReportCard({
  params,
  searchParams,
}: {
  params: { riderId: string };
  searchParams: { from?: string; to?: string };
}) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = parseDate(searchParams.from, defaultFrom);
  const to = parseDate(searchParams.to, defaultTo);

  const rider = await prisma.rider.findUnique({
    where: { id: params.riderId },
    include: {
      centre: { select: { name: true, address: true } },
      batch: { select: { name: true, dayOfWeek: true, startTime: true, endTime: true, coachId: true } },
    },
  });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();

  const coach = rider.batch?.coachId
    ? await prisma.user.findUnique({ where: { id: rider.batch.coachId }, select: { name: true } })
    : null;

  const [attendances, exams, invoices, payments, certificates, skillStatusesRecent] =
    await Promise.all([
      prisma.attendance.findMany({
        where: { riderId: rider.id, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      }),
      prisma.exam.findMany({
        where: {
          riderId: rider.id,
          status: "completed",
          updatedAt: { gte: from, lte: to },
        },
        orderBy: { date: "desc" },
      }),
      prisma.invoice.findMany({
        where: { riderId: rider.id, createdAt: { gte: from, lte: to } },
        include: { payments: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.payment.aggregate({
        where: { invoice: { riderId: rider.id }, paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.certificate.findMany({
        where: { riderId: rider.id, issuedAt: { gte: from, lte: to } },
        orderBy: { issuedAt: "desc" },
      }),
      prisma.riderSkillStatus.findMany({
        where: { riderId: rider.id, status: "mastered", updatedAt: { gte: from, lte: to } },
        include: { skill: { select: { name: true, discipline: true } } },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  // Attendance numbers
  const aPresent = attendances.filter((a) => a.status === "present").length;
  const aLate = attendances.filter((a) => a.status === "late").length;
  const aAbsent = attendances.filter((a) => a.status === "absent").length;
  const aExcused = attendances.filter((a) => a.status === "excused").length;
  const aTotal = attendances.length;
  const attendancePct = aTotal > 0 ? Math.round(((aPresent + aLate) / aTotal) * 100) : null;

  const invoicedTotal = invoices.reduce((s, inv) => s + inv.amount, 0);
  const paidInPeriod = payments._sum.amount ?? 0;
  const dueInvoices = invoices.filter((inv) => inv.status === "due");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/reports">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <PeriodForm from={searchParams.from ?? from.toISOString().slice(0, 10)} to={searchParams.to ?? to.toISOString().slice(0, 10)} />
          <PrintButton />
        </div>
      </div>

      <div className="mx-auto max-w-[820px] bg-white p-8 shadow print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-primary pb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{rider.centre.name}</div>
            <h1 className="mt-1 text-2xl font-extrabold">Monthly Report Card</h1>
            <p className="text-xs text-muted-foreground">{rider.centre.address ?? ""}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-muted-foreground">Period</div>
            <div className="text-sm font-bold">
              {formatDate(from)} — {formatDate(to)}
            </div>
          </div>
        </div>

        {/* Rider summary */}
        <section className="mt-4 grid grid-cols-3 gap-4 rounded-md border bg-muted/30 p-3 text-xs">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Rider</div>
            <div className="text-base font-bold">
              {rider.firstName} {rider.lastName}
            </div>
            <div className="text-muted-foreground">DOB {formatDate(rider.dob)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Current level</div>
            <div className="text-sm font-semibold">{rider.currentLevel ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Batch & coach</div>
            <div className="text-sm">{rider.batch?.name ?? "—"}</div>
            <div className="text-muted-foreground">{coach?.name ?? ""}</div>
          </div>
        </section>

        {/* KPI band */}
        <section className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          <Tile
            label="Attendance"
            value={attendancePct === null ? "—" : `${attendancePct}%`}
            sub={aTotal > 0 ? `${aPresent + aLate}/${aTotal} sessions` : "no sessions"}
          />
          <Tile
            label="Skills mastered"
            value={String(skillStatusesRecent.length)}
            sub="this period"
          />
          <Tile
            label="Exams this period"
            value={String(exams.length)}
            sub={`${exams.filter((e) => e.passed).length} passed`}
          />
          <Tile
            label="Paid this period"
            value={`₹${Math.round(paidInPeriod).toLocaleString("en-IN")}`}
            sub={`${dueInvoices.length} outstanding`}
            warn={dueInvoices.length > 0}
          />
        </section>

        {/* Attendance detail */}
        <Section title="1 · Attendance">
          {aTotal === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions in this period.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 text-xs">
              <KV label="Present" value={aPresent} good />
              <KV label="Late" value={aLate} />
              <KV label="Absent" value={aAbsent} bad={aAbsent > 0} />
              <KV label="Excused" value={aExcused} />
            </div>
          )}
        </Section>

        {/* Progress detail */}
        <Section title="2 · Progress milestones this period">
          {skillStatusesRecent.length === 0 ? (
            <p className="text-xs text-muted-foreground">No new skills mastered in this window.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {skillStatusesRecent.slice(0, 12).map((s) => (
                <li key={s.skillId} className="flex items-center justify-between border-b border-dashed pb-1">
                  <span>
                    <b>{s.skill.name}</b>{" "}
                    <span className="text-muted-foreground">· {s.skill.discipline.replaceAll("_", " ")}</span>
                  </span>
                  <span className="text-muted-foreground">{formatDate(s.updatedAt)}</span>
                </li>
              ))}
              {skillStatusesRecent.length > 12 && (
                <li className="text-xs italic text-muted-foreground">
                  …and {skillStatusesRecent.length - 12} more.
                </li>
              )}
            </ul>
          )}
        </Section>

        {/* Exams detail */}
        <Section title="3 · Exam results">
          {exams.length === 0 ? (
            <p className="text-xs text-muted-foreground">No exams completed in this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left">
                <tr className="text-[10px] uppercase text-muted-foreground">
                  <th className="pb-1">Date</th>
                  <th className="pb-1">Level</th>
                  <th className="pb-1">Score</th>
                  <th className="pb-1">Examiner</th>
                  <th className="pb-1">Result</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id} className="border-t border-dashed">
                    <td className="py-1">{formatDate(e.date)}</td>
                    <td className="py-1">L{e.level}</td>
                    <td className="py-1">{e.totalScore ?? "—"}</td>
                    <td className="py-1">{e.examinerName}</td>
                    <td className="py-1">
                      {e.passed === true && <Badge variant="success">PASS</Badge>}
                      {e.passed === false && <Badge variant="destructive">FAIL</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Fees detail */}
        <Section title="4 · Fees">
          {invoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">No invoices raised in this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left">
                <tr className="text-[10px] uppercase text-muted-foreground">
                  <th className="pb-1">Date</th>
                  <th className="pb-1">Kind</th>
                  <th className="pb-1">Amount</th>
                  <th className="pb-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-dashed">
                    <td className="py-1">{formatDate(inv.createdAt)}</td>
                    <td className="py-1 capitalize">{inv.kind}</td>
                    <td className="py-1">₹{inv.amount.toLocaleString("en-IN")}</td>
                    <td className="py-1">
                      <Badge
                        variant={inv.status === "paid" ? "success" : inv.status === "due" ? "warning" : "destructive"}
                      >
                        {inv.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td colSpan={2} className="pt-1">
                    Period total
                  </td>
                  <td colSpan={2} className="pt-1">₹{invoicedTotal.toLocaleString("en-IN")} invoiced · ₹
                    {Math.round(paidInPeriod).toLocaleString("en-IN")} paid
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Section>

        {/* Certificates detail */}
        {certificates.length > 0 && (
          <Section title="5 · Certificates issued">
            <ul className="space-y-1 text-xs">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-dashed pb-1">
                  <span>
                    <b>{c.type === "promotion" ? "Level Promotion" : c.type}</b>
                    {c.levelName ? ` · ${c.levelName}` : ""}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{c.serialNo}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Footer */}
        <div className="mt-8 grid grid-cols-2 gap-6 border-t pt-4 text-[11px]">
          <div>
            <div className="border-t border-foreground pt-1 font-semibold">{coach?.name ?? "Coach"}</div>
            <div className="text-muted-foreground">Coach signature</div>
          </div>
          <div className="text-right">
            <div className="border-t border-foreground pt-1 font-semibold">Centre Manager</div>
            <div className="text-muted-foreground">{rider.centre.name}</div>
          </div>
        </div>
        <div className="mt-3 text-center text-[9px] uppercase tracking-wider text-muted-foreground">
          Generated {formatDate(new Date())} · Equiwings Central Admin Panel
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${warn ? "border-amber-400 bg-amber-50" : ""}`}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 print:break-inside-avoid">
      <h2 className="mb-2 border-b text-xs font-bold uppercase tracking-wider text-primary">{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  return (
    <div
      className={`rounded-md border p-2 ${
        good ? "border-emerald-300 bg-emerald-50" : bad ? "border-red-300 bg-red-50" : "border-muted bg-muted/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
