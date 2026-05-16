// Shared data helpers for the parent portal. Both the server pages and the JSON
// API routes call into here, so the parent-link enforcement lives in one place.
// Calling code MUST pass the authenticated parent's userId — never the riderId or
// session role alone, since access is gated on the explicit ParentLink row.

import { prisma } from "./prisma";

export type ChildSummary = {
  riderId: string;
  firstName: string;
  lastName: string;
  currentLevel: string | null;
  status: string;
  photoUrl: string | null;
  centreName: string;
  attendancePct: number | null;
  attendedSessions: number;
  totalSessions: number;
  upcomingExamAt: Date | null;
  latestCertificateSerial: string | null;
  unpaidInvoiceCount: number;
  relationship: string;
};

// Resolve the parent's children list with a roll-up for the dashboard cards. Returns
// [] when the user has no links, so callers can render an empty-state.
export async function getParentChildren(parentUserId: string): Promise<ChildSummary[]> {
  const links = await prisma.parentLink.findMany({
    where: { parentUserId },
    include: {
      rider: {
        select: {
          id: true, firstName: true, lastName: true, currentLevel: true, status: true,
          photoUrl: true, centre: { select: { name: true } },
        },
      },
    },
  });
  if (links.length === 0) return [];

  // Last-30-days attendance + soonest upcoming exam + latest cert + unpaid invoice
  // count — one batched query per dimension so it scales as siblings grow.
  const riderIds = links.map((l) => l.riderId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [attendance, upcomingExams, latestCerts, unpaidInvoices] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId: { in: riderIds }, date: { gte: since } },
      select: { riderId: true, status: true },
    }),
    prisma.exam.findMany({
      where: { riderId: { in: riderIds }, status: { not: "completed" }, date: { gte: now } },
      orderBy: { date: "asc" },
      select: { riderId: true, date: true },
    }),
    prisma.certificate.findMany({
      where: { riderId: { in: riderIds } },
      orderBy: { issuedAt: "desc" },
      select: { riderId: true, serialNo: true },
    }),
    prisma.invoice.groupBy({
      by: ["riderId"],
      where: { riderId: { in: riderIds }, status: "due" },
      _count: { riderId: true },
    }),
  ]);

  const attByRider = new Map<string, { total: number; present: number }>();
  for (const a of attendance) {
    const slot = attByRider.get(a.riderId) ?? { total: 0, present: 0 };
    slot.total += 1;
    if (a.status === "present" || a.status === "late") slot.present += 1;
    attByRider.set(a.riderId, slot);
  }
  const nextExamByRider = new Map<string, Date>();
  for (const e of upcomingExams) if (!nextExamByRider.has(e.riderId)) nextExamByRider.set(e.riderId, e.date);
  const latestCertByRider = new Map<string, string>();
  for (const c of latestCerts) if (!latestCertByRider.has(c.riderId)) latestCertByRider.set(c.riderId, c.serialNo);
  const unpaidByRider = new Map<string, number>();
  for (const row of unpaidInvoices) unpaidByRider.set(row.riderId, row._count.riderId);

  return links.map((l) => {
    const att = attByRider.get(l.riderId);
    return {
      riderId: l.riderId,
      firstName: l.rider.firstName,
      lastName: l.rider.lastName,
      currentLevel: l.rider.currentLevel,
      status: l.rider.status,
      photoUrl: l.rider.photoUrl,
      centreName: l.rider.centre.name,
      attendancePct: att && att.total > 0 ? Math.round((att.present / att.total) * 100) : null,
      attendedSessions: att?.present ?? 0,
      totalSessions: att?.total ?? 0,
      upcomingExamAt: nextExamByRider.get(l.riderId) ?? null,
      latestCertificateSerial: latestCertByRider.get(l.riderId) ?? null,
      unpaidInvoiceCount: unpaidByRider.get(l.riderId) ?? 0,
      relationship: l.relationship,
    };
  });
}

// Verify a parent-link exists for (parentUserId, riderId). Returns the rider with
// the fields the portal renders, or null when the parent isn't linked to this rider.
// Use this anywhere a parent fetches a specific child — it's the gate.
export async function getChildIfLinked(parentUserId: string, riderId: string) {
  const link = await prisma.parentLink.findUnique({
    where: { parentUserId_riderId: { parentUserId, riderId } },
  });
  if (!link) return null;

  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    include: { centre: { select: { name: true } }, batch: { select: { name: true, startTime: true, endTime: true } } },
  });
  return rider ? { rider, relationship: link.relationship } : null;
}

export async function getChildDetail(parentUserId: string, riderId: string) {
  const linked = await getChildIfLinked(parentUserId, riderId);
  if (!linked) return null;
  const { rider, relationship } = linked;

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 86400000);

  const [attendance, skills, exams, certificates, invoices, upcomingLessons] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId, date: { gte: since } },
      orderBy: { date: "desc" },
      select: { date: true, status: true, reason: true },
    }),
    prisma.riderSkillStatus.findMany({
      where: { riderId },
      include: { skill: { select: { name: true, levelId: true, level: { select: { name: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.exam.findMany({
      where: { riderId },
      orderBy: { date: "desc" },
      select: { id: true, date: true, level: true, status: true, totalScore: true, passed: true, examinerName: true },
      take: 10,
    }),
    prisma.certificate.findMany({
      where: { riderId },
      orderBy: { issuedAt: "desc" },
      select: { id: true, serialNo: true, levelName: true, type: true, issuedAt: true },
    }),
    prisma.invoice.findMany({
      where: { riderId },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true, kind: true, status: true, dueDate: true, createdAt: true },
      take: 12,
    }),
    prisma.horseAllocation.findMany({
      where: {
        riderId,
        purpose: "lesson",
        startAt: { gte: now, lte: twoWeeks },
        lesson: { status: "scheduled" },
      },
      orderBy: { startAt: "asc" },
      take: 12,
      include: {
        horse: { select: { name: true, stableNo: true } },
        lesson: { select: { id: true, batch: { select: { name: true, level: true } } } },
      },
    }),
  ]);

  const present = attendance.filter((a) => a.status === "present" || a.status === "late").length;
  const attendancePct = attendance.length > 0 ? Math.round((present / attendance.length) * 100) : null;

  return { rider, relationship, attendance, attendancePct, skills, exams, certificates, invoices, upcomingLessons };
}
