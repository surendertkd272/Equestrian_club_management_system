// Record a failed outbound notification to NotificationDispatchLog.
//
// Called from lib/sms.ts / lib/email.ts / lib/whatsapp.ts at every
// `{ ok: false }` return path. The general audit log already captures
// these events too, but this dedicated table makes them queryable as a
// first-class concept (e.g. "what failed in the last hour, grouped by
// channel?") without scanning the much-larger AuditLog table.
//
// Best-effort: if the DB insert itself fails, we swallow — the original
// notification failure has already been audit()'d, and we don't want a
// downstream log failure to mask the user-visible behaviour the caller
// was reporting.

import { prisma } from "./prisma";

export async function logDispatchFailure(opts: {
  channel: "sms" | "email" | "whatsapp";
  error: string;
  recipient: string;
  refType?: string;
  refRowId?: string;
}): Promise<void> {
  try {
    await prisma.notificationDispatchLog.create({
      data: {
        status: "failed",
        channel: opts.channel,
        error: opts.error,
        recipient: opts.recipient,
        refType: opts.refType ?? null,
        refRowId: opts.refRowId ?? null,
      },
    });
  } catch {
    // Swallow — see header comment.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-channel send idempotency (H5).
//
// The in-app notification carries its own dedup (recentlyNotified), but the
// SMS/WhatsApp/email channels had none of their own: a sweep that crashed after
// sending SMS but before recording the in-app row would, on the next run,
// either drop a channel (in-app row exists → whole notification skipped) or
// duplicate one (in-app row missing → everything re-sent). Recording each
// successful send and checking it before the next send makes every channel
// independently idempotent.
//
// Windowed, not permanent: a legitimate repeat (e.g. a fee reminder for the
// same invoice on day 1 AND day 3) must still go out, so we only suppress a
// resend of the SAME (channel, refType, refRowId, recipient) within the window
// below — enough to absorb a near-term crash/retry, short of the daily cadence.
const DISPATCH_DEDUPE_WINDOW_MS = 18 * 60 * 60 * 1000;

export async function recentlySent(opts: {
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  refType: string;
  refRowId: string;
}): Promise<boolean> {
  const since = new Date(Date.now() - DISPATCH_DEDUPE_WINDOW_MS);
  const row = await prisma.notificationDispatchLog.findFirst({
    where: {
      status: "sent",
      channel: opts.channel,
      recipient: opts.recipient,
      refType: opts.refType,
      refRowId: opts.refRowId,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return row !== null;
}

export async function logDispatchSuccess(opts: {
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  refType?: string;
  refRowId?: string;
}): Promise<void> {
  try {
    await prisma.notificationDispatchLog.create({
      data: {
        status: "sent",
        channel: opts.channel,
        error: "",
        recipient: opts.recipient,
        refType: opts.refType ?? null,
        refRowId: opts.refRowId ?? null,
      },
    });
  } catch {
    // Best-effort — a failed dedup-record must not fail the actual delivery.
  }
}
