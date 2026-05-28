// SendGrid email dispatch. Pure fetch + Bearer auth — no SDK.
//
// Same mental model as lib/sms.ts:
//   - SENDGRID_API_KEY + SENDGRID_FROM_EMAIL set → real send
//   - Otherwise → dry-run: log + audit, never throws
//
// Templates are inline HTML — no template engine to keep dep tree small.

import { audit } from "./audit";
import { logDispatchFailure } from "./notify-dispatch-log";

export type SendEmailResult =
  | { ok: true; messageId?: string; skipped?: boolean }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

// RFC 5322 is over-engineered; this is the "good-enough" subset.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(addr: string | null | undefined): boolean {
  if (!addr) return false;
  return EMAIL_RE.test(addr.trim());
}

export type EmailRef = {
  type: string; // matches notification.type values, e.g. "invoice.due_soon"
  rowId?: string;
  payload?: Record<string, unknown>;
};

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string; // optional plain-text fallback
  ref?: EmailRef;
}): Promise<SendEmailResult> {
  if (!isValidEmail(opts.to)) {
    await audit({
      action: "email.invalid_address",
      tableName: "email",
      rowId: opts.ref?.rowId ?? "—",
      after: { rawTo: opts.to, subject: opts.subject, type: opts.ref?.type },
    });
    await logDispatchFailure({
      channel: "email",
      error: "INVALID_ADDRESS",
      recipient: String(opts.to ?? ""),
      refType: opts.ref?.type,
      refRowId: opts.ref?.rowId,
    });
    return { ok: false, error: "INVALID_ADDRESS" };
  }

  // Subject length cap — most clients display ~70-100 chars
  const subject = opts.subject.length > 200 ? opts.subject.slice(0, 197) + "…" : opts.subject;

  if (!isEmailConfigured()) {
    console.log(`[email dry-run] to=${opts.to} subject="${subject}"`);
    await audit({
      action: "email.dry_run",
      tableName: "email",
      rowId: opts.ref?.rowId ?? "—",
      after: {
        to: opts.to,
        subject,
        // Truncate body for the audit log — we don't want every email's full HTML stored.
        bodyPreview: opts.html.replace(/<[^>]+>/g, " ").slice(0, 200),
        type: opts.ref?.type,
        payload: opts.ref?.payload,
      },
    });
    return { ok: true, skipped: true };
  }

  const fromEmail = process.env.SENDGRID_FROM_EMAIL!;
  const fromName = process.env.SENDGRID_FROM_NAME ?? "Equiwings";
  const body = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [
      ...(opts.text ? [{ type: "text/plain", value: opts.text }] : []),
      { type: "text/html", value: opts.html },
    ],
  };

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      await audit({
        action: "email.upstream_error",
        tableName: "email",
        rowId: opts.ref?.rowId ?? "—",
        after: {
          to: opts.to,
          subject,
          status: res.status,
          error: errText.slice(0, 500),
          type: opts.ref?.type,
        },
      });
      await logDispatchFailure({
        channel: "email",
        error: `SENDGRID_${res.status}`,
        recipient: opts.to,
        refType: opts.ref?.type,
        refRowId: opts.ref?.rowId,
      });
      return { ok: false, error: `SENDGRID_${res.status}` };
    }
    // SendGrid returns message id in the X-Message-Id header.
    const messageId = res.headers.get("x-message-id") ?? undefined;
    await audit({
      action: "email.sent",
      tableName: "email",
      rowId: opts.ref?.rowId ?? "—",
      after: { to: opts.to, subject, messageId, type: opts.ref?.type },
    });
    return { ok: true, messageId };
  } catch (err) {
    await audit({
      action: "email.network_error",
      tableName: "email",
      rowId: opts.ref?.rowId ?? "—",
      after: { to: opts.to, error: (err as Error).message, type: opts.ref?.type },
    });
    await logDispatchFailure({
      channel: "email",
      error: "NETWORK",
      recipient: opts.to,
      refType: opts.ref?.type,
      refRowId: opts.ref?.rowId,
    });
    return { ok: false, error: "NETWORK" };
  }
}

// Minimal HTML template shared by every transactional email.
// Inline styles only — email clients strip <style> tags.
export function renderEmail(opts: {
  heading: string;
  body: string; // HTML
  ctaText?: string;
  ctaUrl?: string;
  centreName?: string;
}): string {
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<p style="margin:24px 0;">
           <a href="${opts.ctaUrl}" style="display:inline-block;padding:10px 18px;background:#177434;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${opts.ctaText}</a>
         </p>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="background:#fff;border-radius:12px;padding:32px;max-width:560px;">
        <tr><td>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#177434;">
            ${opts.centreName ?? "Equiwings"}
          </div>
          <h1 style="margin:8px 0 16px;font-size:22px;line-height:1.3;color:#111;">${opts.heading}</h1>
          <div style="font-size:14px;line-height:1.55;color:#374151;">${opts.body}</div>
          ${cta}
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p style="margin:0;font-size:11px;color:#6b7280;">
            This is an automated message from Equiwings Central Admin Panel. Reply to this email or contact your centre if you have questions.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
