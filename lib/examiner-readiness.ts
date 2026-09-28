// Can this judge mark on the exam day? Shown on the exam-day and sitting
// screens, where it matters: a visiting judge who never did their first
// sign-in (temporary password) is refused by the API until they do, and one
// whose access ends before the exam can't mark it at all — the manager found
// out on the morning, when the judge was already standing in the arena.
export type JudgeReadiness = { ok: boolean; label: string; tone: "success" | "warning" | "destructive" };

export function examinerReadiness(
  u: { status: string; mustChangePassword: boolean; accessExpiresAt: Date | null },
  examDate: Date,
  now: Date = new Date(),
): JudgeReadiness {
  if (u.status !== "active") return { ok: false, label: "inactive", tone: "destructive" };
  if (u.accessExpiresAt && u.accessExpiresAt <= now) return { ok: false, label: "access ended", tone: "destructive" };
  // examDate is noon UTC of the exam day; access runs to the end of its day.
  if (u.accessExpiresAt && u.accessExpiresAt < examDate) {
    return { ok: false, label: "access ends before the exam", tone: "destructive" };
  }
  if (u.mustChangePassword) return { ok: false, label: "hasn't signed in yet", tone: "warning" };
  return { ok: true, label: "ready", tone: "success" };
}
