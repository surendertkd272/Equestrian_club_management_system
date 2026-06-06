// Helpers for the rider/student portal. A RIDER user account is linked to a
// Rider row via Rider.userId (unique). All access flows through that link —
// the route handler passes session.userId and we resolve from there.

import { prisma } from "./prisma";

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

  // Skills are organised per ProgressLevel; the rider's currentLevel links to
  // ProgressLevel.name. When the rider is ranked we scope the skill counts to
  // their level (a motivating "progress at my rank" view); when Unranked there
  // is no level catalogue to measure against, so these resolve to 0 and the UI
  // hides the level progress bar.
  const levelFilter = rider.currentLevel
    ? { centreId: rider.centreId, name: rider.currentLevel }
    : null;

  const [attendance, upcomingExam, latestCert, unpaidInvoices, skillsMastered, levelSkillsTotal, levelSkillsMastered] = await Promise.all([
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
    // Catalog-wide mastered count — used for the headline "Skills" stat.
    prisma.riderSkillStatus.count({ where: { riderId: rider.id, status: "mastered" } }),
    // Skills defined at the rider's current level, and how many they've mastered.
    levelFilter ? prisma.skill.count({ where: { level: levelFilter } }) : Promise.resolve(0),
    levelFilter
      ? prisma.riderSkillStatus.count({
          where: { riderId: rider.id, status: "mastered", skill: { level: levelFilter } },
        })
      : Promise.resolve(0),
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
    skillsMastered,
    levelSkillsTotal,
    levelSkillsMastered,
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

  const [attendance, skills, exams, certificates, notifications, upcomingLessons] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId: rider.id, date: { gte: since } },
      orderBy: { date: "desc" },
      take: 30,
      select: { date: true, status: true, reason: true },
    }),
    prisma.riderSkillStatus.findMany({
      where: { riderId: rider.id },
      include: { skill: { select: { name: true, level: { select: { name: true } } } } },
      orderBy: { updatedAt: "desc" },
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

  return { rider, attendance, skills, exams, certificates, notifications, upcomingLessons };
}
