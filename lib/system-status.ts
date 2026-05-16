// System health snapshot for the owner portal. Cheap reads only — this
// shows up on the owner dashboard so it has to render fast on every
// visit. All queries here use indexes; no full-table scans.

import { prisma } from "./prisma";

export type SystemStatus = {
  lastCronAt: Date | null;
  cronAgeMin: number | null;
  cronStale: boolean; // true when >25h since last sweep
  emailErrorCount24h: number;
  smsErrorCount24h: number;
  webhookErrorCount24h: number;
  failedLogins24h: number;
  recentActions: { action: string; count: number }[];
};

export async function getSystemStatus(): Promise<SystemStatus> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Last sweep — pulled from PlatformAuditLog where the cron handler logs.
  // Falls back to cron.sweep AuditLog if PlatformAuditLog has none.
  const lastCron = await prisma.auditLog.findFirst({
    where: { action: "cron.sweep" },
    orderBy: { at: "desc" },
    select: { at: true },
  });

  // Outbound dispatch failures — sms/email/whatsapp routes audit their
  // own errors via specific action strings.
  const [emailErr, smsErr, webhookErr, failedLogins, recent] = await Promise.all([
    prisma.auditLog.count({
      where: {
        at: { gte: dayAgo },
        action: { in: ["email.upstream_error", "email.network_error"] },
      },
    }),
    prisma.auditLog.count({
      where: {
        at: { gte: dayAgo },
        action: { in: ["sms.upstream_error", "sms.network_error"] },
      },
    }),
    prisma.auditLog.count({
      where: {
        at: { gte: dayAgo },
        action: { startsWith: "razorpay.webhook" },
        NOT: { action: "razorpay.webhook.payment_captured" },
      },
    }),
    // Failed login attempts captured at the auth layer.
    prisma.auditLog.count({
      where: {
        at: { gte: dayAgo },
        action: "auth.login_failed",
      },
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { at: { gte: dayAgo } },
      _count: true,
      orderBy: { _count: { action: "desc" } },
      take: 5,
    }),
  ]);

  const cronAgeMin = lastCron ? Math.floor((Date.now() - lastCron.at.getTime()) / 60000) : null;
  return {
    lastCronAt: lastCron?.at ?? null,
    cronAgeMin,
    cronStale: cronAgeMin === null || cronAgeMin > 25 * 60,
    emailErrorCount24h: emailErr,
    smsErrorCount24h: smsErr,
    webhookErrorCount24h: webhookErr,
    failedLogins24h: failedLogins,
    recentActions: recent.map((r) => ({ action: r.action, count: r._count })),
  };
}
