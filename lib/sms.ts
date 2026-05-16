// Twilio SMS dispatch. Pure fetch + Basic auth — no SDK dep.
//
// Behavior:
//   - When TWILIO_ACCOUNT_SID/TOKEN/FROM are all set → POSTs to Twilio
//   - Otherwise → dry-run: logs to console + audit, returns ok:true skipped:true
//   - Phone normalization assumes Indian numbers; pass +91XXXXXXXXXX or 10-digit
//   - All dispatches are fire-and-forget at the call site; never throws

import { audit } from "./audit";

export type SendSmsResult =
  | { ok: true; sid?: string; skipped?: boolean }
  | { ok: false; error: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM,
  );
}

// Accepts: "+919876543210", "919876543210", "9876543210". Returns E.164 or null.
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

export type SmsRef = {
  type: string; // e.g. "invoice.due_soon"
  rowId?: string; // invoiceId / riderId / examId — for the audit trail
  payload?: Record<string, unknown>;
};

export async function sendSms(opts: {
  to: string;
  body: string;
  ref?: SmsRef;
}): Promise<SendSmsResult> {
  const to = normalizeIndianPhone(opts.to);
  if (!to) {
    await audit({
      action: "sms.invalid_phone",
      tableName: "sms",
      rowId: opts.ref?.rowId ?? "—",
      after: { rawTo: opts.to, type: opts.ref?.type },
    });
    return { ok: false, error: "INVALID_PHONE" };
  }

  // Hard cap to keep cost predictable. Twilio splits at 160 GSM-7 chars; we keep messages tight.
  const body = opts.body.length > 320 ? opts.body.slice(0, 317) + "…" : opts.body;

  if (!isSmsConfigured()) {
    // Dry-run: log + audit, no upstream call.
    console.log(`[sms dry-run] to=${to} body="${body}"`);
    await audit({
      action: "sms.dry_run",
      tableName: "sms",
      rowId: opts.ref?.rowId ?? "—",
      after: { to, body, type: opts.ref?.type, payload: opts.ref?.payload },
    });
    return { ok: true, skipped: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM!;
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

  const form = new URLSearchParams({ To: to, From: from, Body: body });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      await audit({
        action: "sms.upstream_error",
        tableName: "sms",
        rowId: opts.ref?.rowId ?? "—",
        after: { to, body, status: res.status, error: errText.slice(0, 500), type: opts.ref?.type },
      });
      return { ok: false, error: `TWILIO_${res.status}` };
    }
    const data: any = await res.json();
    await audit({
      action: "sms.sent",
      tableName: "sms",
      rowId: opts.ref?.rowId ?? "—",
      after: { to, body, sid: data.sid, type: opts.ref?.type },
    });
    return { ok: true, sid: data.sid };
  } catch (err) {
    await audit({
      action: "sms.network_error",
      tableName: "sms",
      rowId: opts.ref?.rowId ?? "—",
      after: { to, error: (err as Error).message, type: opts.ref?.type },
    });
    return { ok: false, error: "NETWORK" };
  }
}
