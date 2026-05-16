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

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

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
    ]);

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
              <span className="font-medium">Rider onboarding (§4.1)</span>
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
              <span className="font-medium">Attendance marking + roster + batches (§4.2)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Staff onboarding (§4.8)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Exams: scheduling + scoring engine + templates (§4.4/4.16-19)</span>
              <Badge variant="success">Implemented (merged from exam module)</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Certificates auto-issue + public QR verify (§4.21 / §8)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Horse roster + workload + allocations (§4.13)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Vet medicines: inventory + prescribe + withdrawal→rest (§4.12)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Tasks: kanban + overdue/escalation + templates (§4.9)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Tack & Equipment: QR scan → issue/return + maintenance (§4.10/4.11)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Notifications: in-app feed + 4 wired triggers (§4.22)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Progress: per-skill checklist + cohort heatmap (§4.3)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Monthly parent report cards (§4.5)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Competitions: classes + entries + placements + public scoreboard (§4.6 / §4.14)</span>
              <Badge variant="success">Implemented</Badge>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Performance Analytics: trends + medal leaderboard (§4.7)</span>
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
