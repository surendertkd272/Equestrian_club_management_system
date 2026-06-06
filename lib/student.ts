// Helpers for the rider/student portal. A RIDER user account is linked to a
// Rider row via Rider.userId (unique). All access flows through that link —
// the route handler passes session.userId and we resolve from there.

import { prisma } from "./prisma";

// Canonical month key for the monthly-skill catalog ("YYYY-MM"), in IST so it
// matches what /monthly-skills writes (UTC + 5h30m). The dashboard tracks the
// coach's monthly skill snapshot — distinct from the exam/level components in
// RiderSkillStatus.
export function currentYearMonth(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Returns the rider tied to this signed-in user (or null if their portal access
// hasn't been wired up by a manager yet).
export async function getRiderForUser(userId: string) {
  return prisma.rider.findFirst({
    where: { userId },
    include: {
      centre: { select: { name: true, slug: true } },
      batch: { select: { name: true, dayOfWeek: true, startTime: true, endTime: true } },
    },
  });
}

// Compact summary for the student dashboard card — 90-day attendance %,
// upcoming exam, latest cert, unpaid invoice count, plus skills mastered.
export async function getStudentSummary(userId: string) {
  const rider = await getRiderForUser(userId);
  if (!rider) return null;

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Monthly skills: the coach's per-month snapshot against an admin-curated
  // list for THIS month (MonthlySkillCatalog/Mark), not the exam/level
  // components. "Mastered" = rating 3 (0 not-yet · 1 needs-work · 2 confident).
  const yearMonth = currentYearMonth();
  const monthlyCatalogWhere = { centreId: rider.centreId, yearMonth, active: true };

  const [attendance, upcomingExam, latestCert, unpaidInvoices, monthlySkillsTotal, monthlySkillsMastered] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId: rider.id, date: { gte: since } },
      select: { status: true },
    }),
    prisma.exam.findFirst({
      where: { riderId: rider.id, status: { not: "completed" }, date: { gte: now } },
      orderBy: { date: "asc" },
      select: { date: true, level: true, examinerName: true },
    }),
    prisma.certificate.findFirst({
      where: { riderId: rider.id },
      orderBy: { issuedAt: "desc" },
      select: { serialNo: true, levelName: true, issuedAt: true },
    }),
    prisma.invoice.count({ where: { riderId: rider.id, status: "due" } }),
    prisma.monthlySkillCatalog.count({ where: monthlyCatalogWhere }),
    prisma.monthlySkillMark.count({
      where: { riderId: rider.id, rating: 3, catalog: monthlyCatalogWhere },
    }),
  ]);

  const present = attendance.filter((a) => a.status === "present" || a.status === "late").length;
  const attendancePct = attendance.length > 0 ? Math.round((present / attendance.length) * 100) : null;

  return {
    rider,
    attendancePct,
    attendedSessions: present,
    totalSessions: attendance.length,
    upcomingExam,
    latestCert,
    unpaidInvoices,
    monthlySkillsTotal,
    monthlySkillsMastered,
    skillsMonth: yearMonth,
  };
}

// Full detail for the student detail page — pulls everything the rider's view
// needs in one batched call.
export async function getStudentDetail(userId: string) {
  const rider = await getRiderForUser(userId);
  if (!rider) return null;

  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 86400000);
  const yearMonth = currentYearMonth();

  const [attendance, monthlySkills, exams, certificates, notifications, upcomingLessons] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId: rider.id, date: { gte: since } },
      orderBy: { date: "desc" },
      take: 30,
      select: { date: true, status: true, reason: true },
    }),
    // This month's monthly-skill catalog with this rider's rating per skill.
    prisma.monthlySkillCatalog.findMany({
      where: { centreId: rider.centreId, yearMonth, active: true },
      orderBy: { orderIndex: "asc" },
      include: { marks: { where: { riderId: rider.id }, select: { rating: true, coachNotes: true } } },
    }),
    prisma.exam.findMany({
      where: { riderId: rider.id },
      orderBy: { date: "desc" },
      take: 8,
      select: { id: true, date: true, level: true, status: true, totalScore: true, passed: true, examinerName: true },
    }),
    prisma.certificate.findMany({
      where: { riderId: rider.id },
      orderBy: { issuedAt: "desc" },
      select: { id: true, serialNo: true, levelName: true, type: true, issuedAt: true },
    }),
    prisma.notification.findMany({
      where: { userId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, title: true, body: true, link: true, createdAt: true },
    }),
    // Upcoming lessons this rider is allocated to. Joins through
    // HorseAllocation so the horse name shows up in the card.
    prisma.horseAllocation.findMany({
      where: {
        riderId: rider.id,
        purpose: "lesson",
        startAt: { gte: now, lte: twoWeeks },
        lesson: { status: { in: ["scheduled"] } },
      },
      orderBy: { startAt: "asc" },
      take: 12,
      include: {
        horse: { select: { name: true, stableNo: true } },
        lesson: { select: { id: true, status: true, batch: { select: { name: true, level: true } } } },
      },
    }),
  ]);

  // Flatten each catalog row to { label, rating, coachNotes } using the
  // rider's mark (default rating 0 = "not yet" when unmarked).
  const skills = monthlySkills.map((c) => ({
    label: c.skillLabel,
    rating: c.marks[0]?.rating ?? 0,
    coachNotes: c.marks[0]?.coachNotes ?? null,
  }));

  return { rider, attendance, skills, skillsMonth: yearMonth, exams, certificates, notifications, upcomingLessons };
}
