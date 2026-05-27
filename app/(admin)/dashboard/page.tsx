import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { AnnouncementsBanner } from "@/components/dashboard/announcements-banner";
import { NpsWidget } from "@/components/dashboard/nps-widget";
import {
  FarrierDashboard,
  VetDashboard,
  StableManagerDashboard,
  GroomDashboard,
  ExaminerDashboard,
  CompetitionManagerDashboard,
  AccountantDashboard,
  HeadCoachDashboard,
  CoachDashboard,
} from "./role-dashboards";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);

  // Role-specific dashboards. The generic KPI grid below stays for roles that
  // benefit from org-wide visibility (admin / centre_manager / head_coach /
  // coach), since their work crosses every module.
  if (session.role === "FARRIER") return <FarrierDashboard centreId={centreId} />;
  if (session.role === "VET") return <VetDashboard centreId={centreId} />;
  if (session.role === "STABLE_MANAGER") return <StableManagerDashboard centreId={centreId} />;
  if (session.role === "GROOM") return <GroomDashboard centreId={centreId} userId={session.userId} />;
  if (session.role === "EXAMINER") return <ExaminerDashboard centreId={centreId} userId={session.userId} />;
  if (session.role === "COMPETITION_MANAGER") return <CompetitionManagerDashboard centreId={centreId} />;
  if (session.role === "ACCOUNTANT") return <AccountantDashboard centreId={centreId} />;
  if (session.role === "INVENTORY_MANAGER") return <StableManagerDashboard centreId={centreId} />;
  if (session.role === "HEAD_COACH") return <HeadCoachDashboard centreId={centreId} />;
  if (session.role === "COACH") return <CoachDashboard centreId={centreId} userId={session.userId} />;
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
  ] = await Promise.all([
      prisma.rider.count({ where: { ...where, status: "active" } }),
      prisma.rider.count({ where: { ...where, status: "pending_payment" } }),
      prisma.batch.count({ where }),
      prisma.invoice.count({ where: { ...where, status: "due" } }),
      prisma.payment.aggregate({
        where: {
          invoice: centreId ? { centreId } : undefined,
          paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
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
        where: { date: { gte: todayStart, lt: todayEnd }, batch: centreId ? { centreId } : undefined },
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
    ]);

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
    const orgId = session.centreId
      ? (await prisma.centre.findUnique({ where: { id: session.centreId }, select: { orgId: true } }))?.orgId
      : null;
    [staffCount, centreCount] = await Promise.all([
      prisma.user.count({
        where: {
          ...(centreId ? { centreId } : {}),
          role: { notIn: ["SUPER_ADMIN", "CENTRE_MANAGER"] as any },
        },
      }),
      prisma.centre.count({ where: orgId ? { orgId } : undefined }),
    ]);
  }
  const checklist = showChecklist
    ? [
        {
          label: "Add a centre",
          done: centreCount > 0,
          href: "/centres",
          hint: "your first location",
        },
        { label: "Invite staff", done: staffCount > 0, href: "/users", hint: "coaches, vets, grooms" },
        { label: "Add horses", done: horses > 0, href: "/horses/new", hint: "build the roster" },
        { label: "Create batches", done: batches > 0, href: "/batches", hint: "schedule training slots" },
        {
          label: "Onboard your first rider",
          done: activeRiders + pendingRiders > 0,
          href: "/onboarding",
          hint: "students join here",
        },
      ]
    : [];

  const tiles = [
    { label: "Active riders", value: activeRiders, hint: "status = active" },
    { label: "Pending sign-ups", value: pendingRiders, hint: "awaiting payment" },
    { label: "Batches", value: batches, hint: "scheduled" },
    {
      label: "Today's attendance",
      value: todayPct === null ? "—" : `${todayPct}%`,
      hint: todayTotal > 0 ? `${todayPresent}/${todayTotal} marked present` : "no marks yet",
    },
    { label: "Open invoices", value: openInvoices, hint: "status = due" },
    {
      label: "Revenue (MTD)",
      value: `₹${Math.round(paidThisMonth._sum.amount ?? 0).toLocaleString("en-IN")}`,
      hint: "razorpay + cash",
    },
    { label: "Horses on roster", value: horses },
    {
      label: "Open tasks",
      value: openTasks,
      hint: overdueTasks > 0 ? `${overdueTasks} overdue` : "all on time",
      warn: overdueTasks > 0,
    },
    { label: "Low-stock meds", value: lowStock, hint: "qty ≤ 5", warn: lowStock > 0 },
    {
      label: "Meds expiring < 30 days",
      value: expiringSoon,
      hint: "review & rotate",
      warn: expiringSoon > 0,
    },
    // New-feature widgets — only show "pending your approval" for roles
    // that can actually approve. Reimbursement + vet follow-ups + gate
    // headcount are universally relevant.
    ...(myApproverStage
      ? [{
          label: "Requisitions to approve",
          value: reqPendingMine,
          hint: myApproverStage === "pending_accountant" ? "accountant signoff" : "manager approval",
          warn: reqPendingMine > 0,
        }]
      : []),
    {
      label: "Invoices to reimburse",
      value: invoicesAwaitingReimbursement,
      hint: "paid = false",
      warn: invoicesAwaitingReimbursement > 0,
    },
    {
      label: "Vet follow-ups (next 7d)",
      value: upcomingVetFollowups,
      hint: "scheduled re-checks",
    },
    {
      label: "Staff on premises now",
      value: onPremises,
      hint: "via gate log today",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {session.role === "SUPER_ADMIN" ? "HQ — cross-centre roll-up." : "Centre snapshot."}
        </p>
      </div>

      <AnnouncementsBanner />
      {showChecklist && <SetupChecklist items={checklist} />}
      <NpsWidget />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
                {t.warn && <Badge variant="warning">attention</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{t.value}</div>
              {t.hint && <p className="text-xs text-muted-foreground">{t.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Build status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Rider onboarding </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Auth + multi-tenancy + role permissions</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Riders list + profile</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Fee invoice + Razorpay (mock)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Audit log</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Attendance marking + roster + batches </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Staff onboarding </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Exams: scheduling + scoring engine + templates</span>
              <Badge variant="success">Implemented (merged from exam module)</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Certificates auto-issue + public QR verify </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Horse roster + workload + allocations </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Vet medicines: inventory + prescribe + withdrawal→rest </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Tasks: kanban + overdue/escalation + templates </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Tack & Equipment: QR scan → issue/return + maintenance</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Notifications: in-app feed + 4 wired triggers </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Progress: per-skill checklist + cohort heatmap </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Monthly parent report cards </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Competitions: classes + entries + placements + public scoreboard </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Performance Analytics: trends + medal leaderboard </span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Real Razorpay: hosted checkout + HMAC verify + webhook</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Cron sweeps: fee-due, expiring meds, absence streak, birthdays</span>
              <Badge variant="success">Implemented</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
