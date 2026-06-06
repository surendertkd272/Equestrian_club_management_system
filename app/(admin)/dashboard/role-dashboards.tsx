// Role-specific dashboard panels. The /dashboard server page picks one based
// on session.role; each panel does its own focused query so a FARRIER doesn't
// load "active riders" they don't care about.
//
// Each panel keeps the same shape: KPIs + 1–2 lists or queues that match
// the role's day-to-day workflow.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { HeroCard } from "@/components/dashboard/visuals";
import { kpiIcon } from "@/lib/kpi-icon";
import { formatDateIndia, timeAgo } from "@/lib/i18n";
import { istTodayStr, coachUpdateDateKey, DAILY_UPDATE_ROLES } from "@/lib/coach-update";
import { Hammer, Stethoscope, Boxes, Sparkles, GraduationCap, Trophy, Wallet, Users, ClipboardCheck } from "lucide-react";

// Shared layout: an illustrated HeroCard on the left, the role's KPI tiles on
// the right. Gives every role dashboard the same "designed" top band.
function HeroRow({ hero, children }: { hero: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1">{hero}</div>
      <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-4 lg:col-span-2">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared atoms

function Kpi({ label, value, tone, link }: { label: string; value: number | string; tone?: "amber" | "rose" | "green"; link?: string }) {
  return <StatTile label={label} value={value} tone={tone} link={link} icon={kpiIcon(label)} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// FARRIER

export async function FarrierDashboard({ centreId, features }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fFarriery = features.has("farriery");
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000);

  const [upcoming, overdue, recentlyCompleted] = await Promise.all([
    prisma.farrierVisit.findMany({
      where: { ...where, status: "scheduled", scheduledAt: { gte: now, lte: sevenDays } },
      include: { horse: { select: { name: true, stableNo: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 10,
    }),
    prisma.farrierVisit.findMany({
      where: { ...where, status: "completed", nextDueAt: { lt: now } },
      include: { horse: { select: { name: true, stableNo: true } } },
      orderBy: { nextDueAt: "asc" },
      take: 10,
    }),
    prisma.farrierVisit.findMany({
      where: { ...where, status: "completed" },
      include: { horse: { select: { name: true } } },
      orderBy: { completedAt: "desc" },
      take: 5,
    }),
  ]);

  const nextVisit = upcoming[0];
  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Farrier"
            title={nextVisit ? nextVisit.horse.name : "No visits booked"}
            subtitle={nextVisit ? `Next shoeing · ${formatDateIndia(nextVisit.scheduledAt)}` : "Schedule from the farriery page"}
            icon={<Hammer />}
            stats={[
              { label: "This week", value: upcoming.length },
              { label: "Overdue", value: overdue.length },
              { label: "Done", value: recentlyCompleted.length },
            ]}
            href={fFarriery ? "/farriery" : undefined}
            cta={fFarriery ? "Open farriery" : undefined}
          />
        }
      >
        <Kpi label="Upcoming (7d)" value={upcoming.length} link={fFarriery ? "/farriery" : undefined} />
        <Kpi label="Overdue" value={overdue.length} tone={overdue.length > 0 ? "amber" : undefined} link={fFarriery ? "/farriery" : undefined} />
        <Kpi label="Completed (recent)" value={recentlyCompleted.length} />
      </HeroRow>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>This week's visits</CardTitle></CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing booked in the next 7 days.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {upcoming.map((v) => (
                  <li key={v.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1">
                    <span>
                      <span className="font-medium">{v.horse.name}</span>
                      {v.horse.stableNo && <span className="ml-1 text-xs text-muted-foreground">({v.horse.stableNo})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateIndia(v.scheduledAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Overdue — needs scheduling</CardTitle></CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody's overdue right now. 🐎</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {overdue.map((v) => (
                  <li key={v.id} className="flex items-center justify-between rounded border border-amber-300 bg-amber-50 px-2 py-1">
                    <span className="font-medium">{v.horse.name}</span>
                    <span className="text-xs text-amber-700">Due {formatDateIndia(v.nextDueAt!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VET

export async function VetDashboard({ centreId, features }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fVet = features.has("vet-records");
  const fInjuries = features.has("injuries");
  const now = new Date();
  const thirty = new Date(now.getTime() + 30 * 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [vaccDueSoon, expiringMeds, recentInjuries, lowStockMeds] = await Promise.all([
    prisma.vaccinationSchedule.findMany({
      where: { ...where, nextDueAt: { lte: thirty } },
      include: { horse: { select: { name: true } } },
      orderBy: { nextDueAt: "asc" },
      take: 10,
    }),
    prisma.medicine.findMany({
      where: { ...where, qty: { gt: 0 }, expDate: { lte: thirty } },
      orderBy: { expDate: "asc" },
      take: 10,
    }),
    prisma.injuryLog.findMany({
      where: { ...where, occurredAt: { gte: sevenDaysAgo }, status: { in: ["active", "recovering"] } },
      orderBy: { occurredAt: "desc" },
      take: 10,
    }),
    prisma.medicine.count({
      where: {
        ...where,
        qty: { lte: 5 },
      },
    }),
  ]);

  const nextVacc = vaccDueSoon[0];
  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Veterinary"
            title={nextVacc ? nextVacc.horse.name : "Herd is up to date"}
            subtitle={nextVacc ? `${nextVacc.vaccineLabel} · due ${formatDateIndia(nextVacc.nextDueAt)}` : "No vaccinations due in 30 days"}
            icon={<Stethoscope />}
            stats={[
              { label: "Vacc. due", value: vaccDueSoon.length },
              { label: "Injuries", value: recentInjuries.length },
              { label: "Meds exp.", value: expiringMeds.length },
            ]}
            href={fVet ? "/vaccinations" : undefined}
            cta={fVet ? "Open vaccinations" : undefined}
          />
        }
      >
        <Kpi label="Vaccinations due (30d)" value={vaccDueSoon.length} tone={vaccDueSoon.length > 0 ? "amber" : undefined} link={fVet ? "/vaccinations" : undefined} />
        <Kpi label="Active injuries" value={recentInjuries.length} tone={recentInjuries.length > 0 ? "amber" : undefined} link={fInjuries ? "/injuries" : undefined} />
        <Kpi label="Medicines expiring (30d)" value={expiringMeds.length} tone={expiringMeds.length > 0 ? "amber" : undefined} link={fVet ? "/medicines" : undefined} />
        <Kpi label="Low-stock meds" value={lowStockMeds} link={fVet ? "/medicines" : undefined} />
      </HeroRow>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Vaccinations due</CardTitle></CardHeader>
          <CardContent>
            {vaccDueSoon.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vaccinations due in the next 30 days.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {vaccDueSoon.map((v) => (
                  <li key={v.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1">
                    <span>
                      <span className="font-medium">{v.horse.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{v.vaccineLabel}</span>
                    </span>
                    <span className={`text-xs ${v.nextDueAt < now ? "font-semibold text-rose-600" : "text-muted-foreground"}`}>
                      {formatDateIndia(v.nextDueAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Open injuries</CardTitle></CardHeader>
          <CardContent>
            {recentInjuries.length === 0 ? (
              <p className="text-sm text-muted-foreground">All injuries marked recovered. 🎉</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {recentInjuries.map((i) => (
                  <li key={i.id} className="flex items-start justify-between rounded border bg-muted/30 px-2 py-1">
                    <div>
                      <span className="font-medium">{i.subjectType === "horse" ? "🐴" : "🧍"}</span>{" "}
                      <span className="text-xs">{i.location ?? "—"}</span>
                      <div className="text-[10px] text-muted-foreground">{i.initialNotes.slice(0, 60)}</div>
                    </div>
                    <Badge variant={i.severity === "severe" ? "destructive" : i.severity === "moderate" ? "warning" : "outline"}>
                      {i.severity}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STABLE_MANAGER

export async function StableManagerDashboard({ centreId, features }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fHorses = features.has("horse-management");
  const fTasks = features.has("tasks");
  const fConsumables = features.has("consumables");
  const fInjuries = features.has("injuries");
  const now = new Date();

  const [horses, todayAllocs, openTasks, lowConsumables, recentInjuries] = await Promise.all([
    prisma.horse.count({ where: { ...where, status: "active" } }),
    prisma.horseAllocation.count({
      where: {
        horse: where,
        startAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        endAt: { lte: new Date(new Date().setHours(23, 59, 59, 999)) },
      },
    }),
    prisma.task.count({ where: { ...where, status: { in: ["open", "in_progress"] } } }),
    prisma.consumable.count({ where: { ...where, qty: { lte: 5 } } }),
    prisma.injuryLog.count({ where: { ...where, status: { in: ["active", "recovering"] } } }),
  ]);

  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Stable"
            title={`${horses} horses`}
            subtitle="on the active roster"
            icon={<Boxes />}
            stats={[
              { label: "Allocs today", value: todayAllocs },
              { label: "Open tasks", value: openTasks },
              { label: "Injuries", value: recentInjuries },
            ]}
            href={fHorses ? "/horses" : undefined}
            cta={fHorses ? "Open stable" : undefined}
          />
        }
      >
        <Kpi label="Active horses" value={horses} link={fHorses ? "/horses" : undefined} />
        <Kpi label="Allocations today" value={todayAllocs} />
        <Kpi label="Open tasks" value={openTasks} link={fTasks ? "/tasks" : undefined} />
        <Kpi label="Low-stock consumables" value={lowConsumables} tone={lowConsumables > 0 ? "amber" : undefined} link={fConsumables ? "/consumables" : undefined} />
        <Kpi label="Open injuries" value={recentInjuries} tone={recentInjuries > 0 ? "amber" : undefined} link={fInjuries ? "/injuries" : undefined} />
      </HeroRow>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROOM

export async function GroomDashboard({ centreId, userId, features }: { centreId: string | null; userId: string; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fTasks = features.has("tasks");
  const fHorses = features.has("horse-management");
  const now = new Date();
  const dayStart = new Date(now.setHours(0, 0, 0, 0));
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999));

  const [myTasks, todayAllocs, horses] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: userId, status: { in: ["open", "in_progress"] } },
      orderBy: [{ dueAt: "asc" }],
      take: 8,
    }),
    prisma.horseAllocation.findMany({
      where: {
        horse: where,
        startAt: { gte: dayStart, lte: dayEnd },
      },
      include: { horse: { select: { name: true, stableNo: true } } },
      orderBy: { startAt: "asc" },
      take: 12,
    }),
    prisma.horse.count({ where: { ...where, status: "active" } }),
  ]);

  const firstAlloc = todayAllocs[0];
  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="My day"
            title={firstAlloc ? firstAlloc.horse.name : "Nothing scheduled"}
            subtitle={
              firstAlloc
                ? `First up · ${new Date(firstAlloc.startAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
                : "No allocations today"
            }
            icon={<Sparkles />}
            stats={[
              { label: "My tasks", value: myTasks.length },
              { label: "Allocations", value: todayAllocs.length },
              { label: "Horses", value: horses },
            ]}
            href={fTasks ? "/tasks" : undefined}
            cta={fTasks ? "Open my tasks" : undefined}
          />
        }
      >
        <Kpi label="My open tasks" value={myTasks.length} link={fTasks ? "/tasks" : undefined} />
        <Kpi label="Allocations today" value={todayAllocs.length} />
        <Kpi label="Horses on roster" value={horses} link={fHorses ? "/horses" : undefined} />
      </HeroRow>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Today's allocations</CardTitle></CardHeader>
          <CardContent>
            {todayAllocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled today.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {todayAllocs.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1">
                    <span>
                      <span className="font-medium">{a.horse.name}</span>
                      {a.horse.stableNo && <span className="ml-1 text-xs text-muted-foreground">({a.horse.stableNo})</span>}
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">{a.purpose}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.startAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>My tasks</CardTitle></CardHeader>
          <CardContent>
            {myTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {myTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1">
                    <span>
                      <span className="font-medium">{t.title}</span>
                      {t.kind && <Badge variant="outline" className="ml-2 text-[10px]">{t.kind.replace("_", " ")}</Badge>}
                    </span>
                    {t.dueAt && (
                      <span className={`text-xs ${t.dueAt < new Date() ? "text-rose-600" : "text-muted-foreground"}`}>
                        {timeAgo(t.dueAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMINER

export async function ExaminerDashboard({ centreId, userId, features }: { centreId: string | null; userId: string; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fExams = features.has("external-exams");
  const fCerts = features.has("certificates");
  const now = new Date();

  const [upcoming, completedRecent, certsIssued] = await Promise.all([
    prisma.exam.findMany({
      where: { ...where, examinerId: userId, status: "scheduled", date: { gte: now } },
      include: { rider: { select: { firstName: true, lastName: true } } },
      orderBy: { date: "asc" },
      take: 10,
    }),
    prisma.exam.findMany({
      where: { ...where, examinerId: userId, status: "completed" },
      include: { rider: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.certificate.count({
      where: { ...where, signedBy: userId, issuedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    }),
  ]);

  const nextExam = upcoming[0];
  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Examiner"
            title={nextExam ? `${nextExam.rider.firstName} ${nextExam.rider.lastName}` : "No exams scheduled"}
            subtitle={nextExam ? `Level ${nextExam.level} · ${formatDateIndia(nextExam.date)} · ${nextExam.time}` : "Add one from the exams page"}
            icon={<GraduationCap />}
            stats={[
              { label: "Upcoming", value: upcoming.length },
              { label: "Completed", value: completedRecent.length },
              { label: "Certs 30d", value: certsIssued },
            ]}
            href={fExams ? "/exams" : undefined}
            cta={fExams ? "Open exams" : undefined}
          />
        }
      >
        <Kpi label="Upcoming exams" value={upcoming.length} link={fExams ? "/exams" : undefined} />
        <Kpi label="Completed (recent)" value={completedRecent.length} />
        <Kpi label="Certs signed (30d)" value={certsIssued} link={fCerts ? "/certificates" : undefined} />
      </HeroRow>

      <Card>
        <CardHeader><CardTitle>My upcoming exams</CardTitle></CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exams scheduled.{fExams ? <> Add one from <Link href="/exams" className="underline">/exams</Link>.</> : null}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1">
                  <span>
                    <span className="font-medium">{e.rider.firstName} {e.rider.lastName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">Level {e.level}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateIndia(e.date)} · {e.time}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION_MANAGER

export async function CompetitionManagerDashboard({ centreId, features }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fComps = features.has("competitions");
  const fTeams = features.has("teams");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [active, drafts, upcomingEntries, recentResults, nextComp] = await Promise.all([
    prisma.competition.count({
      where: { ...where, status: { in: ["open_for_entries", "live"] } },
    }),
    prisma.competition.count({ where: { ...where, status: "draft" } }),
    prisma.competitionEntry.count({
      where: {
        competition: { ...where, status: { in: ["open_for_entries", "live"] } },
      },
    }),
    prisma.competitionEntry.count({
      where: { competition: where, placement: { in: [1, 2, 3] } },
    }),
    prisma.competition.findFirst({
      where: { ...where, status: { notIn: ["cancelled", "completed"] }, startDate: { gte: todayStart } },
      orderBy: { startDate: "asc" },
      include: { _count: { select: { entries: true } } },
    }),
  ]);

  const compDaysToGo = nextComp
    ? Math.max(0, Math.ceil((nextComp.startDate.getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Next competition"
            title={nextComp ? nextComp.name : "No event scheduled"}
            subtitle={nextComp ? `${formatDateIndia(nextComp.startDate)}${nextComp.venue ? ` · ${nextComp.venue}` : ""}` : "Create one to open entries"}
            icon={<Trophy />}
            stats={[
              { label: "Entries", value: nextComp ? nextComp._count.entries : 0 },
              { label: "Days to go", value: compDaysToGo ?? "—" },
              { label: "Active", value: active },
            ]}
            href={fComps ? "/competitions" : undefined}
            cta={fComps ? "Open competitions" : undefined}
          />
        }
      >
        <Kpi label="Active competitions" value={active} link={fComps ? "/competitions" : undefined} />
        <Kpi label="Drafts" value={drafts} link={fComps ? "/competitions" : undefined} />
        <Kpi label="Total entries" value={upcomingEntries} />
        <Kpi label="Top-3 placements" value={recentResults} link={fTeams ? "/teams" : undefined} />
      </HeroRow>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTANT

export async function AccountantDashboard({ centreId }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [openInvoices, overdue, paidThisMonth, totalCollected] = await Promise.all([
    prisma.invoice.count({ where: { ...where, status: "due" } }),
    prisma.invoice.count({
      where: { ...where, status: "due", dueDate: { lt: new Date() } },
    }),
    prisma.payment.aggregate({
      where: { invoice: centreId ? { centreId } : undefined, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { invoice: centreId ? { centreId } : undefined },
      _sum: { amount: true },
    }),
  ]);

  const paidMTD = Math.round(paidThisMonth._sum.amount ?? 0);
  const allTime = Math.round(totalCollected._sum.amount ?? 0);
  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Collections"
            title={`₹${paidMTD.toLocaleString("en-IN")}`}
            subtitle="collected this month"
            icon={<Wallet />}
            stats={[
              { label: "Open inv.", value: openInvoices },
              { label: "Overdue", value: overdue },
              { label: "All-time ₹", value: allTime.toLocaleString("en-IN") },
            ]}
            href="/finance"
            cta="Open finance"
          />
        }
      >
        <Kpi label="Open invoices" value={openInvoices} link="/finance" />
        <Kpi label="Overdue" value={overdue} tone={overdue > 0 ? "rose" : undefined} link="/finance" />
        <Kpi label="Paid this month (₹)" value={paidMTD} tone="green" />
        <Kpi label="All-time collected (₹)" value={allTime} />
      </HeroRow>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAD_COACH — oversees all coaches' batches. Wants a roll-up of coverage
// (which batches haven't been marked today?), upcoming exams, and recent
// scoring drafts to nudge along.

export async function HeadCoachDashboard({ centreId, features }: { centreId: string | null; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fAttendance = features.has("attendance");
  const fExams = features.has("external-exams");
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const sevenDays = new Date(Date.now() + 7 * 86400000);

  const todayUpdateKey = coachUpdateDateKey(istTodayStr());

  const [batches, markedToday, upcomingExams, draftExams, totalRiders, coachCount, updatesToday] = await Promise.all([
    prisma.batch.findMany({
      where,
      select: { id: true, name: true, coachId: true, _count: { select: { riders: true } } },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: todayStart, lt: todayEnd }, batch: centreId ? { centreId } : undefined },
      select: { batchId: true },
    }),
    prisma.exam.count({
      where: { ...where, date: { gte: todayStart, lte: sevenDays }, status: "scheduled" },
    }),
    prisma.exam.findMany({
      where: { ...where, status: "draft" },
      select: { id: true, level: true, date: true, rider: { select: { firstName: true, lastName: true } } },
      orderBy: { date: "desc" },
      take: 6,
    }),
    prisma.rider.count({ where: { ...where, status: "active" } }),
    prisma.user.count({ where: { ...where, status: "active", role: { in: [...DAILY_UPDATE_ROLES] } } }),
    prisma.coachDailyUpdate.count({ where: { ...where, date: todayUpdateKey } }),
  ]);

  const markedSet = new Set(markedToday.map((m) => m.batchId));
  const unmarked = batches.filter((b) => !markedSet.has(b.id));
  const markedCount = batches.length - unmarked.length;

  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="Coaching"
            title={`${totalRiders} riders`}
            subtitle="across all coaches"
            icon={<Users />}
            progress={{ value: markedCount, max: Math.max(1, batches.length), label: `${markedCount}/${batches.length} batches marked today` }}
            stats={[
              { label: "Exams 7d", value: upcomingExams },
              { label: "Drafts", value: draftExams.length },
              { label: "Updates", value: `${updatesToday}/${coachCount}` },
            ]}
            href={fAttendance ? "/attendance" : undefined}
            cta={fAttendance ? "Open attendance" : undefined}
          />
        }
      >
        <Kpi label="Active riders" value={totalRiders} link="/riders" />
        <Kpi
          label="Batches without attendance (today)"
          value={unmarked.length}
          tone={unmarked.length > 0 ? "amber" : "green"}
          link={fAttendance ? "/attendance" : undefined}
        />
        <Kpi label="Upcoming exams (7d)" value={upcomingExams} link={fExams ? "/exams" : undefined} />
        <Kpi label="Score drafts to finalise" value={draftExams.length} tone={draftExams.length > 0 ? "amber" : undefined} link={fExams ? "/exams" : undefined} />
        <Kpi
          label="Coach updates filed (today)"
          value={`${updatesToday}/${coachCount}`}
          tone={coachCount > 0 && updatesToday < coachCount ? "amber" : "green"}
          link="/daily-update/team"
        />
      </HeroRow>

      {fAttendance && unmarked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batches still unmarked today</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {unmarked.slice(0, 10).map((b) => (
                <li key={b.id} className="flex justify-between border-b py-1">
                  <span>{b.name}</span>
                  <Link href={`/attendance?batch=${b.id}`} className="text-xs text-primary hover:underline">
                    Mark now →
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COACH — own batches + today's teaching workflow. Coaches previously fell
// through to the org-wide admin grid (which exposed finance KPIs they
// shouldn't see); this focuses them on their own roster, attendance, tasks,
// daily checklist, and monthly-skill marking.

export async function CoachDashboard({ centreId, userId, features }: { centreId: string | null; userId: string; features: ReadonlySet<string> }) {
  const where = centreWhere(centreId);
  const fAttendance = features.has("attendance");
  const fTasks = features.has("tasks");
  const fInjuries = features.has("injuries");
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const [myBatches, markedToday, myOpenTasks, checklistsToday, totalRiders] = await Promise.all([
    prisma.batch.findMany({
      where: { ...where, coachId: userId },
      select: { id: true, name: true, _count: { select: { riders: true } } },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: todayStart, lt: todayEnd }, batch: { coachId: userId } },
      select: { batchId: true },
    }),
    prisma.task.count({
      where: { ...where, assigneeId: userId, status: { in: ["open", "in_progress"] } },
    }),
    prisma.checklistSubmission.count({
      where: { ...where, submittedByUserId: userId, submittedAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.rider.count({ where: { ...where, status: "active" } }),
  ]);

  const markedSet = new Set(markedToday.map((m) => m.batchId));
  const unmarked = myBatches.filter((b) => !markedSet.has(b.id));
  const markedCount = myBatches.length - unmarked.length;

  return (
    <div className="space-y-6">
      <HeroRow
        hero={
          <HeroCard
            kicker="My batches"
            title={`${myBatches.length} batches`}
            subtitle="assigned to you"
            icon={<ClipboardCheck />}
            progress={{ value: markedCount, max: Math.max(1, myBatches.length), label: `${markedCount}/${myBatches.length} marked today` }}
            stats={[
              { label: "My tasks", value: myOpenTasks },
              { label: "Checklist", value: checklistsToday > 0 ? "✓" : "—" },
              { label: "Riders", value: totalRiders },
            ]}
            href={fAttendance ? "/attendance" : undefined}
            cta={fAttendance ? "Mark attendance" : undefined}
          />
        }
      >
        <Kpi label="My batches" value={myBatches.length} link="/batches" />
        <Kpi
          label="My batches unmarked (today)"
          value={unmarked.length}
          tone={unmarked.length > 0 ? "amber" : "green"}
          link={fAttendance ? "/attendance" : undefined}
        />
        <Kpi label="My open tasks" value={myOpenTasks} tone={myOpenTasks > 0 ? "amber" : undefined} link={fTasks ? "/tasks?mine=1" : undefined} />
        <Kpi
          label="Daily checklist filed today"
          value={checklistsToday > 0 ? "Yes" : "No"}
          tone={checklistsToday > 0 ? "green" : "amber"}
          link="/checklists"
        />
      </HeroRow>

      <div className="grid gap-4 md:grid-cols-2">
        {fAttendance && unmarked.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">My batches still unmarked today</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {unmarked.slice(0, 10).map((b) => (
                  <li key={b.id} className="flex justify-between border-b py-1">
                    <span>
                      {b.name} <span className="text-xs text-muted-foreground">· {b._count.riders} riders</span>
                    </span>
                    <Link href={`/attendance?batch=${b.id}`} className="text-xs text-primary hover:underline">
                      Mark now →
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today's coach actions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between border-b py-1">
                <span>Submit daily checklist</span>
                <Link href="/checklists" className="text-xs text-primary hover:underline">Open →</Link>
              </li>
              <li className="flex justify-between border-b py-1">
                <span>Mark monthly skills</span>
                <Link href="/monthly-skills" className="text-xs text-primary hover:underline">Open →</Link>
              </li>
              {fInjuries && (
                <li className="flex justify-between border-b py-1">
                  <span>Log a horse injury</span>
                  <Link href="/injuries" className="text-xs text-primary hover:underline">Open →</Link>
                </li>
              )}
              <li className="flex justify-between py-1">
                <span>Active riders at centre</span>
                <span className="text-xs text-muted-foreground">{totalRiders}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
