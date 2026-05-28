// Per-user notification delivery preferences. Stored as JSON on
// User.notifPrefsJson so we don't carry a fixed-schema table for an evolving
// surface (new channels, quiet-hours rules, mute lists). All lookups go
// through getNotifPrefs() which fills missing fields with safe defaults.

import { prisma } from "./prisma";

export type NotifChannel = "inApp" | "email" | "sms" | "whatsapp";

export type NotifPrefs = {
  inApp: boolean;        // in-app row in /notifications
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  // 24h format "HH:MM"; non-critical messages held until the window ends.
  // Empty string disables quiet hours.
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const DEFAULT_PREFS: NotifPrefs = {
  inApp: true,
  email: true,
  sms: false,        // SMS costs ₹0.20–0.50/msg; off by default, manager opts in
  whatsapp: true,
  quietHoursStart: "",
  quietHoursEnd: "",
};

export async function getNotifPrefs(userId: string): Promise<NotifPrefs> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifPrefsJson: true },
  });
  return mergePrefs(u?.notifPrefsJson ?? null);
}

// Accepts either a string (legacy / tests) or a parsed JsonValue (native
// jsonb column). Falls back to DEFAULT_PREFS on anything malformed.
export function mergePrefs(json: unknown): NotifPrefs {
  if (json === null || json === undefined || json === "") return DEFAULT_PREFS;
  try {
    const raw = typeof json === "string" ? JSON.parse(json) : json;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_PREFS;
    const parsed = raw as Partial<NotifPrefs>;
    return {
      inApp: parsed.inApp ?? DEFAULT_PREFS.inApp,
      email: parsed.email ?? DEFAULT_PREFS.email,
      sms: parsed.sms ?? DEFAULT_PREFS.sms,
      whatsapp: parsed.whatsapp ?? DEFAULT_PREFS.whatsapp,
      quietHoursStart: typeof parsed.quietHoursStart === "string" ? parsed.quietHoursStart : "",
      quietHoursEnd: typeof parsed.quietHoursEnd === "string" ? parsed.quietHoursEnd : "",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// "Is this user inside their quiet-hours window right now?" — used to gate
// non-critical sends (rider attendance updates, low-stock pings). Critical
// alerts (severe injury, password reset) ignore quiet hours entirely.
export function isInQuietHours(prefs: NotifPrefs, now: Date = new Date()): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const [sh, sm] = prefs.quietHoursStart.split(":").map(Number);
  const [eh, em] = prefs.quietHoursEnd.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  // Overnight window e.g. 22:00 → 07:00 wraps midnight.
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export function allowsChannel(prefs: NotifPrefs, channel: NotifChannel): boolean {
  return !!prefs[channel];
}
