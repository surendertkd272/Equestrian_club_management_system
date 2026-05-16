// WhatsApp dispatch via Meta Cloud API. Pure fetch — no SDK.
//
// Behavior mirrors lib/sms.ts and lib/email.ts:
//   - Configured (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN) → real send
//   - Otherwise → dry-run: log + audit, never throws
//
// Important Meta constraint: outside the 24h customer-service window you can only send
// **pre-approved template messages**. Most of our triggers (cron-fired) are outbound-only,
// so they MUST use templates. Inside the 24h window you can send freeform text/media.
//
// Each trigger declares a templateName + 1+ body params; you register the templates in
// the Meta WhatsApp Business Manager under "Message templates", set the same name, and
// arrange the body variables in the same order.
//
// Reference templates (you'd register these in Meta dashboard):
//   ew_invoice_due_soon       — body params: {1}=rider name, {2}=days, {3}=amount
//   ew_absence_streak         — body params: {1}=rider name
//   ew_birthday               — body params: {1}=rider name, {2}=age
//   ew_exam_passed            — body params: {1}=rider name, {2}=level, {3}=score, {4}=max
//   ew_payment_received       — body params: {1}=rider name, {2}=amount, {3}=last-8 ref

import { audit } from "./audit";
import { normalizeIndianPhone } from "./sms";

const META_BASE = process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com/v18.0";

export type SendWhatsAppResult =
  | { ok: true; messageId?: string; skipped?: boolean }
  | { ok: false; error: string };

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

export type WhatsAppRef = {
  type: string; // mirrors notification.type
  rowId?: string;
  payload?: Record<string, unknown>;
};

// The template "shape" we pass into Meta. Body params order matches the registered template.
export type WhatsAppTemplate = {
  name: string;
  language?: string; // BCP-47, e.g. "en" or "en_GB". Defaults to "en".
  bodyParams: string[]; // strings for the {1}, {2}, … placeholders in the template body
};

export async function sendWhatsApp(opts: {
  to: string;
  template: WhatsAppTemplate;
  // For audit + dry-run readability: the rendered body if you want to log what would have gone.
  previewBody?: string;
  ref?: WhatsAppRef;
}): Promise<SendWhatsAppResult> {
  const to = normalizeIndianPhone(opts.to);
  if (!to) {
    await audit({
      action: "whatsapp.invalid_phone",
      tableName: "whatsapp",
      rowId: opts.ref?.rowId ?? "—",
      after: { rawTo: opts.to, template: opts.template.name, type: opts.ref?.type },
    });
    return { ok: false, error: "INVALID_PHONE" };
  }

  if (!isWhatsAppConfigured()) {
    console.log(`[whatsapp dry-run] to=${to} template=${opts.template.name} params=${JSON.stringify(opts.template.bodyParams)}`);
    await audit({
      action: "whatsapp.dry_run",
      tableName: "whatsapp",
      rowId: opts.ref?.rowId ?? "—",
      after: {
        to,
        template: opts.template.name,
        params: opts.template.bodyParams,
        preview: opts.previewBody,
        type: opts.ref?.type,
      },
    });
    return { ok: true, skipped: true };
  }

  const body = {
    messaging_product: "whatsapp",
    // Meta wants the number WITHOUT the leading +.
    to: to.startsWith("+") ? to.slice(1) : to,
    type: "template",
    template: {
      name: opts.template.name,
      language: { code: opts.template.language ?? "en" },
      components: [
        {
          type: "body",
          parameters: opts.template.bodyParams.map((p) => ({ type: "text", text: p })),
        },
      ],
    },
  };

  const url = `${META_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      await audit({
        action: "whatsapp.upstream_error",
        tableName: "whatsapp",
        rowId: opts.ref?.rowId ?? "—",
        after: {
          to,
          template: opts.template.name,
          status: res.status,
          error: errText.slice(0, 500),
          type: opts.ref?.type,
        },
      });
      return { ok: false, error: `META_${res.status}` };
    }
    const data: any = await res.json();
    const messageId = data?.messages?.[0]?.id;
    await audit({
      action: "whatsapp.sent",
      tableName: "whatsapp",
      rowId: opts.ref?.rowId ?? "—",
      after: { to, template: opts.template.name, messageId, type: opts.ref?.type },
    });
    return { ok: true, messageId };
  } catch (err) {
    await audit({
      action: "whatsapp.network_error",
      tableName: "whatsapp",
      rowId: opts.ref?.rowId ?? "—",
      after: { to, error: (err as Error).message, type: opts.ref?.type },
    });
    return { ok: false, error: "NETWORK" };
  }
}
