import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getFeaturesForSession, getOrgIdForSession } from "@/lib/features-gate";
import { istTodayStr, coachUpdateDateKey, DAILY_UPDATE_ROLES } from "@/lib/coach-update";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartCard, HeroCard, ActivityTimeline } from "@/components/dashboard/visuals";
import { Sparkline, MiniBars, RingGauge } from "@/components/ui/charts";
import { formatDateIndia } from "@/lib/i18n";
import {
  Users, UserPlus, CalendarClock, CalendarCheck, Receipt, IndianRupee, PawPrint,
  ListChecks, Pill, ClipboardList, Hourglass, ShoppingCart, Wallet, Stethoscope, DoorOpen,
  Trophy,
} from "lucide-react";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { AnnouncementsBanner } from "@/components/dashboard/announcements-banner";
import { NpsWidget } from "@/components/dashboard/nps-widget";
import {
  FarrierDashboard,
  VetDashboard,
  StableManagerDashboard,
  GroomDashboard,
  ExaminerDashboard,
  AccountantDashboard,
  HeadCoachDashboard,
  CoachDashboard,
} from "./role-dashboards";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  // Bind every centre-scoped query to the caller's org. For an HQ user on
  // "all centres" (centreId=null) the old centreWhere produced an EMPTY
  // filter and leaked every org's rows; tenantWhere keeps it org-bounded.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard"); // fail closed if the org can't be resolved
  const where = tenantWhere(centreId, orgId);
  // Load the org's enabled features so feature-gated surfaces below (the
  // exams timeline, role-specific dashboards) only render what's turned on.
  const features = await getFeaturesForSession(session);
  // /exams is gated on "external-exams" — only show the exams timeline + its
  // link when the org has it on.
  const hasExams = features.has("external-exams");

  // Role-specific dashboards. The generic KPI grid below stays for roles that
  // benefit from org-wide visibility (admin / centre_manager / head_coach /
  // coach), since their work crosses every module.
  if (session.role === "FARRIER") return <FarrierDashboard centreId={centreId} features={features} />;
  if (session.role === "VET") return <VetDashboard centreId={centreId} features={features} />;
  if (session.role === "STABLE_MANAGER") return <StableManagerDashboard centreId={centreId} features={features} />;
  if (session.role === "GROOM") return <GroomDashboard centreId={centreId} userId={session.userId} features={features} />;
  if (session.role === "EXAMINER") return <ExaminerDashboard centreId={centreId} userId={session.userId} features={features} />;
  if (session.role === "ACCOUNTANT") return <AccountantDashboard centreId={centreId} features={features} />;
  if (session.role === "INVENTORY_MANAGER") return <StableManagerDashboard centreId={centreId} features={features} />;
  if (session.role === "HEAD_COACH") return <HeadCoachDashboard centreId={centreId} features={features} />;
  if (session.role === "COACH") return <CoachDashboard centreId={centreId} userId={session.userId} features={features} />;
  // External auditor — their only job is the inspection sheet; send them there.
  if (session.role === "INSPECTION_OFFICER") redirect("/inspections");

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // New-feature widget queries — kept side-by-side with the existing tiles
  // so the dashboard renders in one trip. Each is centre-scoped via `where`.
  // For the gate "currently on premises" tile we pull all of today's events
  // and aggregate in JS (rather than per-staff subquery) — easier to read,
  // negligible cost for a single centre's daily traffic.
  const sevenDays = new Date(Date.now() + 7 * 86400000);
  const myApproverStage: "pending_manager" | "pending_accountant" | null =
    (session.role as string) === "ACCOUNTANT" ? "pending_accountant" :
    (["CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER", "SUPER_ADMIN"] as string[]).includes(session.role) ? "pending_manager" :
    null;

  const [
    activeRiders,
    pendingRiders,
    batches,
    openInvoices,
    paidThisMonth,
    paidLastMonth,
    horses,
    lowStock,
    expiringSoon,
    todaysAttendance,
    openTasks,
    overdueTasks,
    reqPendingMine,
    invoicesAwaitingReimbursement,
    upcomingVetFollowups,
    gateEventsToday,
    coachStaffCount,
    coachUpdatesToday,
  ] = await Promise.all([
      prisma.rider.count({ where: { ...where, status: "active" } }),
      prisma.rider.count({ where: { ...where, status: "pending_payment" } }),
      prisma.batch.count({ where }),
      prisma.invoice.count({ where: { ...where, status: "due" } }),
      prisma.payment.aggregate({
        where: {
          invoice: tenantWhere(centreId, orgId),
          paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { amount: true },
      }),
      // Last month's revenue — for an honest month-over-month delta on the tile.
      prisma.payment.aggregate({
        where: {
          invoice: tenantWhere(centreId, orgId),
          paidAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
            lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
      }),
      prisma.horse.count({ where }),
      prisma.medicine.count({ where: { ...where, qty: { lte: 5 } } }),
      prisma.medicine.count({
        where: { ...where, expDate: { lte: new Date(Date.now() + 30 * 86400000) } },
      }),
      prisma.attendance.groupBy({
        by: ["status"],
        where: { date: { gte: todayStart, lt: todayEnd }, batch: tenantWhere(centreId, orgId) },
        _count: true,
      }),
      prisma.task.count({ where: { ...where, status: { in: ["open", "in_progress"] } } }),
      prisma.task.count({
        where: { ...where, status: { in: ["open", "in_progress"] }, dueAt: { lt: new Date() } },
      }),
      myApproverStage
        ? prisma.requisition.count({ where: { ...where, stage: myApproverStage } })
        : Promise.resolve(0),
      prisma.expense.count({ where: { ...where, paid: false } }),
      prisma.vetVisit.count({
        where: { ...where, followUpAt: { gte: new Date(), lte: sevenDays } },
      }),
      prisma.staffGateEvent.findMany({
        where: { ...where, occurredAt: { gte: todayStart, lt: todayEnd } },
        select: { staffUserId: true, direction: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
      }),
      prisma.user.count({ where: { ...where, status: "active", role: { in: [...DAILY_UPDATE_ROLES] } } }),
      prisma.coachDailyUpdate.count({ where: { ...where, date: coachUpdateDateKey(istTodayStr()) } }),
    ]);

  // ── Trend series for the charted headline row ──────────────────────────────
  // Six rolling calendar-month buckets (oldest → current). Real data only — no
  // fabricated trends. Cheap for a single centre; all run in parallel.
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, idx) => {
    const i = 5 - idx;
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    return { start, end, label: start.toLocaleString("en-IN", { month: "short" }) };
  });
  const [revenue6, newRiders6, ridersBeforeWindow, upcomingExams] = await Promise.all([
    Promise.all(
      months.map((m) =>
        prisma.payment.aggregate({
          where: { invoice: tenantWhere(centreId, orgId), paidAt: { gte: m.start, lt: m.end } },
          _sum: { amount: true },
        }),
      ),
    ),
    Promise.all(months.map((m) => prisma.rider.count({ where: { ...where, createdAt: { gte: m.start, lt: m.end } } }))),
    prisma.rider.count({ where: { ...where, createdAt: { lt: months[0].start }, status: { notIn: ["cancelled", "rejected"] } } }),
    hasExams
      ? prisma.exam.findMany({
          where: { ...where, status: "scheduled", date: { gte: todayStart, lte: sevenDays } },
          include: { rider: { select: { firstName: true, lastName: true } } },
          orderBy: { date: "asc" },
          take: 6,
        })
      : Promise.resolve([]),
  ]);

  const revenueSeries = revenue6.map((r) => Math.round(r._sum.amount ?? 0));
  // Cumulative roster growth: onboarded-before-window baseline + each month's
  // new riders, accumulated → a genuine upward line.
  let rosterRun = ridersBeforeWindow;
  const rosterSeries = newRiders6.map((n) => (rosterRun += n));
  const newRidersThisMonth = newRiders6[newRiders6.length - 1];

  // Aggregate gate events: a staff member is "on premises" if their LATEST
  // event today is an IN. Walk events oldest-to-newest, keep direction per
  // staff; count the IN-state ones at the end.
  const latestDir = new Map<string, "in" | "out">();
  for (const e of gateEventsToday) latestDir.set(e.staffUserId, e.direction as "in" | "out");
  const onPremises = [...latestDir.values()].filter((d) => d === "in").length;

  const todayPresent = todaysAttendance.find((g) => g.status === "present")?._count ?? 0;
  const todayTotal = todaysAttendance.reduce((s, g) => s + g._count, 0);
  const todayPct = todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 100) : null;

  // Setup checklist — only show to admins/managers, only when items remain.
  // The component returns null once everything is done, so it costs nothing
  // for established centres beyond the count queries above.
  // Centre count is scoped to the same Organisation as the signed-in user so
  // a Centre Manager on Org B never sees Org A's centre rollup.
  const showChecklist = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  let staffCount = 0;
  let centreCount = 0;
  if (showChecklist) {
    [staffCount, centreCount] = await Promise.all([
      prisma.user.count({
        where: {
          ...tenantWhere(centreId, orgId),
          role: { notIn: ["SUPER_ADMIN", "CENTRE_MANAGER"] as any },
        },
      }),
      // Centre rollup stays bounded to the signed-in user's org.
      prisma.centre.count({ where: { orgId } }),
    ]);
  }
  const checklist = showChecklist
    ? [
        {
          label: "Add a Centre",
          done: centreCount > 0,
          href: "/centres",
          hint: "your first location",
        },
        { label: "Invite Staff", done: staffCount > 0, href: "/users", hint: "coaches, vets, grooms" },
        { label: "Add Horses", done: horses > 0, href: "/horses/new", hint: "build the roster" },
        { label: "Create Batches", done: batches > 0, href: "/batches", hint: "schedule training slots" },
        {
          label: "Onboard Your First Rider",
          done: activeRiders + pendingRiders > 0,
          href: "/onboarding",
          hint: "students join here",
        },
      ]
    : [];

  // Honest month-over-month revenue delta (only when last month had revenue).
  const revThis = paidThisMonth._sum.amount ?? 0;
  const revLast = paidLastMonth._sum.amount ?? 0;
  const revDelta: { value: string; dir: "up" | "down" } | undefined =
    revLast > 0
      ? { value: `${Math.abs(Math.round(((revThis - revLast) / revLast) * 100))}%`, dir: revThis >= revLast ? "up" : "down" }
      : undefined;

  // "Exams this week" timeline — nearest one is the current step.
  const examItems = upcomingExams.map((e, i) => ({
    title: `${e.rider.firstName} ${e.rider.lastName}`,
    meta: `Level ${e.level}`,
    time: formatDateIndia(e.date),
    status: (i === 0 ? "current" : "pending") as "current" | "pending",
    href: "/exams",
  }));

  const tiles = [
    { label: "Pending Sign-Ups", value: pendingRiders, hint: "awaiting payment", icon: <UserPlus className="h-5 w-5" /> },
    { label: "Batches", value: batches, hint: "scheduled", icon: <CalendarClock className="h-5 w-5" /> },
    { label: "Open Invoices", value: openInvoices, hint: "status = due", icon: <Receipt className="h-5 w-5" /> },
    { label: "Horses on Roster", value: horses, icon: <PawPrint className="h-5 w-5" /> },
    {
      label: "Open Tasks",
      value: openTasks,
      hint: overdueTasks > 0 ? `${overdueTasks} overdue` : "all on time",
      warn: overdueTasks > 0,
      icon: <ListChecks className="h-5 w-5" />,
    },
    { label: "Low-Stock Meds", value: lowStock, hint: "qty ≤ 5", warn: lowStock > 0, icon: <Pill className="h-5 w-5" /> },
    {
      label: "Coach Updates (Today)",
      value: coachStaffCount > 0 ? `${coachUpdatesToday}/${coachStaffCount}` : "—",
      hint:
        coachStaffCount > 0 && coachUpdatesToday < coachStaffCount
          ? `${coachStaffCount - coachUpdatesToday} yet to file`
          : "all filed",
      warn: coachStaffCount > 0 && coachUpdatesToday < coachStaffCount,
      icon: <ClipboardList className="h-5 w-5" />,
    },
    {
      label: "Meds Expiring Within 30 Days",
      value: expiringSoon,
      hint: "review & rotate",
      warn: expiringSoon > 0,
      icon: <Hourglass className="h-5 w-5" />,
    },
    // New-feature widgets — only show "pending your approval" for roles
    // that can actually approve. Reimbursement + vet follow-ups + gate
    // headcount are universally relevant.
    ...(myApproverStage
      ? [{
          label: "Requisitions to Approve",
          value: reqPendingMine,
          hint: myApproverStage === "pending_accountant" ? "accountant signoff" : "manager approval",
          warn: reqPendingMine > 0,
          icon: <ShoppingCart className="h-5 w-5" />,
        }]
      : []),
    {
      label: "Invoices to Reimburse",
      value: invoicesAwaitingReimbursement,
      hint: "paid = false",
      warn: invoicesAwaitingReimbursement > 0,
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      label: "Vet Follow-Ups (Next 7d)",
      value: upcomingVetFollowups,
      hint: "scheduled re-checks",
      icon: <Stethoscope className="h-5 w-5" />,
    },
    {
      label: "Staff on Premises Now",
      value: onPremises,
      hint: "via gate log today",
      icon: <DoorOpen className="h-5 w-5" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      <AnnouncementsBanner />
      {showChecklist && <SetupChecklist items={checklist} />}
      <NpsWidget />

      {/* Charted headline row — the metrics that show momentum. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          label="Revenue (MTD)"
          value={`₹${Math.round(revThis).toLocaleString("en-IN")}`}
          delta={revDelta}
          sub="razorpay + cash · 6-month trend"
          icon={<IndianRupee className="h-5 w-5" />}
          chart={<MiniBars data={revenueSeries} />}
        />
        <ChartCard
          label="New Riders (This Month)"
          value={newRidersThisMonth}
          sub={`${months[0].label}–${months[months.length - 1].label} sign-ups`}
          icon={<UserPlus className="h-5 w-5" />}
          chart={<Sparkline data={newRiders6} />}
          link="/riders"
        />
        <ChartCard
          label="Active Roster"
          value={activeRiders}
          sub={`${rosterSeries[rosterSeries.length - 1]} onboarded all-time`}
          icon={<Users className="h-5 w-5" />}
          chart={<Sparkline data={rosterSeries} />}
          link="/riders"
        />
      </div>

      {/* Feature row — hero, attendance dial, this-week timeline. */}
      <div className={`grid gap-4 ${hasExams ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        <HeroCard
          kicker="At a Glance"
          title={`${activeRiders} Active Riders`}
          subtitle="Your roster snapshot"
          icon={<Trophy />}
          stats={[
            { label: "Horses", value: horses },
            { label: "Batches", value: batches },
            { label: "Attendance", value: todayPct === null ? "—" : `${todayPct}%` },
          ]}
          href="/riders"
          cta="View Roster"
        />

        <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <CalendarCheck className="h-3.5 w-3.5" /> Today&apos;s attendance
          </div>
          <div className="flex flex-1 items-center justify-center py-2">
            <RingGauge
              value={todayPct ?? 0}
              max={100}
              label={todayPct === null ? "—" : `${todayPct}%`}
              caption={todayTotal > 0 ? `${todayPresent}/${todayTotal} present` : "no marks yet"}
            />
          </div>
        </div>

        {hasExams && (
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Exams this week</div>
              <Link href="/exams" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <ActivityTimeline items={examItems} />
          </div>
        )}
      </div>

      {/* Dense secondary metrics. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">More Metrics</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <StatTile
              key={t.label}
              label={t.label}
              value={t.value}
              sub={t.hint}
              icon={t.icon}
              tone={t.warn ? "amber" : "default"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
