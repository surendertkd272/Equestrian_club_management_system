// How an examiner reads in a picker: "Judge A · visiting until 12 Oct ·
// hasn't signed in yet". Tells the manager, before the day, which visiting
// judges are time-limited and which haven't done their first sign-in (they
// can't mark anything until they have).
export function examinerLabel(u: { name: string; accessExpiresAt: Date | null; mustChangePassword: boolean }): string {
  const parts = [u.name];
  if (u.accessExpiresAt) {
    parts.push(
      `visiting until ${u.accessExpiresAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}`,
    );
  }
  if (u.mustChangePassword) parts.push("hasn't signed in yet");
  return parts.join(" · ");
}
