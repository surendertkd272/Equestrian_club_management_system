// Unified activity timeline for a rider or a horse. Pulls from every domain
// that touches the subject (attendance, exams, certs, comp entries, parent
// links for riders; allocations, health logs, vaccinations, farrier, injuries,
// medicine usage for horses) and merges into a single chronological feed.
//
// Designed to be cheap — each per-domain query takes the top 30 rows; the
// merged list is then capped at 50 before render. For a busy rider with a
// year of attendance, paging would need to come later.

import { prisma } from "./prisma";

export type ActivityItem = {
  id: string;
  at: Date;
  kind: string;          // e.g. "attendance.present" | "exam.passed"
  title: string;
  detail?: string;
  link?: string;
};

export async function riderActivity(riderId: string): Promise<ActivityItem[]> {
  const [
    attendances,
    exams,
    certs,
    skills,
    parents,
    injuries,
  ] = await Promise.all([
    prisma.attendance.findMany({
      where: { riderId },
      orderBy: { date: "desc" },
      take: 20,
      select: { id: true, date: true, status: true, reason: true, batchId: true },
    }),
    prisma.exam.findMany({
      where: { riderId },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, updatedAt: true, level: true, status: true, totalScore: true, passed: true, date: true },
    }),
    prisma.certificate.findMany({
      where: { riderId },
      orderBy: { issuedAt: "desc" },
      take: 10,
      select: { id: true, issuedAt: true, serialNo: true, type: true, levelName: true },
    }),
    prisma.riderSkillStatus.findMany({
      where: { riderId, status: "mastered" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { skill: { select: { name: true, level: { select: { name: true } } } } },
    }),
    prisma.parentLink.findMany({
      where: { riderId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { parent: { select: { name: true } } },
    }),
    prisma.injuryLog.findMany({
      where: { subjectType: "rider", subjectId: riderId },
      orderBy: { occurredAt: "desc" },
      take: 10,
    }),
  ]);

  const items: ActivityItem[] = [
    ...attendances.map((a) => ({
      id: `att-${a.id}`,
      at: a.date,
      kind: `attendance.${a.status}`,
      title: `Attendance · ${a.status}`,
      detail: a.reason ?? undefined,
    })),
    ...exams.map((e) => ({
      id: `exam-${e.id}`,
      at: e.updatedAt,
      kind: e.passed === true ? "exam.passed" : e.status === "completed" ? "exam.completed" : "exam.scheduled",
      title:
        e.passed === true
          ? `🎉 Passed Level ${e.level}`
          : e.status === "completed"
            ? `Exam Level ${e.level} — ${e.passed === false ? "did not pass" : "completed"}`
            : `Exam Level ${e.level} scheduled`,
      detail: e.totalScore != null ? `Score ${e.totalScore}` : undefined,
      link: `/exams/${e.id}`,
    })),
    ...certs.map((c) => ({
      id: `cert-${c.id}`,
      at: c.issuedAt,
      kind: `certificate.${c.type}`,
      title: `Certificate issued — ${c.levelName ?? c.type}`,
      detail: c.serialNo,
      link: `/certificates/${c.id}`,
    })),
    ...skills.map((s) => ({
      id: `skill-${s.skillId}-${s.riderId}`,
      at: s.updatedAt,
      kind: "skill.mastered",
      title: `Mastered: ${s.skill.name}`,
      detail: s.skill.level?.name,
    })),
    ...parents.map((p) => ({
      id: `parent-${p.id}`,
      at: p.createdAt,
      kind: "parent.linked",
      title: `Linked parent: ${p.parent.name} (${p.relationship})`,
    })),
    ...injuries.map((i) => ({
      id: `injury-${i.id}`,
      at: i.occurredAt,
      kind: `injury.${i.severity}`,
      title: `Injury — ${i.severity}`,
      detail: i.location ?? undefined,
      link: "/injuries",
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50);
}

export async function horseActivity(horseId: string): Promise<ActivityItem[]> {
  const [allocations, health, vaccinations, farrier, injuries, meds] = await Promise.all([
    prisma.horseAllocation.findMany({
      where: { horseId },
      orderBy: { startAt: "desc" },
      take: 15,
      include: { rider: { select: { firstName: true, lastName: true } } },
    }),
    prisma.horseHealthLog.findMany({
      where: { horseId },
      orderBy: { recordedAt: "desc" },
      take: 10,
    }),
    prisma.vaccinationSchedule.findMany({
      where: { horseId, lastGivenAt: { not: null } },
      orderBy: { lastGivenAt: "desc" },
      take: 10,
    }),
    prisma.farrierVisit.findMany({
      where: { horseId },
      orderBy: { scheduledAt: "desc" },
      take: 10,
    }),
    prisma.injuryLog.findMany({
      where: { subjectType: "horse", subjectId: horseId },
      orderBy: { occurredAt: "desc" },
      take: 10,
    }),
    prisma.medicineUsage.findMany({
      where: { horseId },
      orderBy: { usedAt: "desc" },
      take: 10,
      include: { medicine: { select: { name: true } } },
    }),
  ]);

  const items: ActivityItem[] = [
    ...allocations.map((a) => ({
      id: `alloc-${a.id}`,
      at: a.startAt,
      kind: `allocation.${a.purpose}`,
      title: `Allocated for ${a.purpose}`,
      detail: a.rider ? `${a.rider.firstName} ${a.rider.lastName}` : undefined,
    })),
    ...health.map((h) => ({
      id: `health-${h.id}`,
      at: h.recordedAt,
      kind: "health.vitals",
      title: "Health check",
      detail: [
        h.tempC != null ? `${h.tempC}°C` : null,
        h.heartRateBpm != null ? `HR ${h.heartRateBpm}` : null,
      ].filter(Boolean).join(" · ") || undefined,
    })),
    ...vaccinations.map((v) => ({
      id: `vacc-${v.id}-${v.lastGivenAt!.toISOString()}`,
      at: v.lastGivenAt!,
      kind: "vaccination.given",
      title: `Vaccinated: ${v.vaccineLabel}`,
      detail: `Next due ${v.nextDueAt.toDateString()}`,
    })),
    ...farrier.map((f) => ({
      id: `farr-${f.id}`,
      at: f.completedAt ?? f.scheduledAt,
      kind: f.status === "completed" ? "farrier.completed" : "farrier.scheduled",
      title: f.status === "completed" ? `Farrier visit — ${f.workType.replace("_", " ")}` : `Farrier visit scheduled (${f.workType.replace("_", " ")})`,
      detail: f.farrierName,
    })),
    ...injuries.map((i) => ({
      id: `inj-${i.id}`,
      at: i.occurredAt,
      kind: `injury.${i.severity}`,
      title: `Injury — ${i.severity}`,
      detail: i.location ?? undefined,
    })),
    ...meds.map((m) => ({
      id: `med-${m.id}`,
      at: m.usedAt,
      kind: "medicine.used",
      title: `Treated with ${m.medicine.name}`,
      detail: `${m.dose} · ${m.route}${m.reason ? ` · ${m.reason}` : ""}`,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50);
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
