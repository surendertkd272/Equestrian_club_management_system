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
