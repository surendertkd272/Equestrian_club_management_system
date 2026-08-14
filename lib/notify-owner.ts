import { sendEmail, renderEmail } from "./email";

// Platform-owner notifications — the "something happened on your platform"
// channel, as distinct from the tenant-facing emails the sweeps already send.
//
// The trial lifecycle notified the CLUB at every transition (trial ended,
// account suspended) and told the platform owner nothing. Transitions did land
// in PlatformAuditLog, but that only helps someone who opens the owner portal
// and goes looking — which is the same reason a dead cron went unnoticed for
// two months. Billing is deliberately manual for now, so these emails ARE the
// process: a trial that ends without one is a customer nobody follows up.
//
// Address resolution: OWNER_NOTIFY_EMAIL if set, else OPS_ALERT_EMAIL, which
// already exists for sweep failures. Keeping the fallback means this works
// today without new configuration.
// Escape anything that came from a user before it lands in the HTML body.
//
// These emails are assembled from unauthenticated signup input — club name,
// administrator name. Unescaped, someone could register as
// `<a href="...">Click here to verify</a>` and have that render as a link in a
// message that looks like it came from the platform. The recipient is the
// owner, so this is phishing-into-your-own-inbox rather than XSS, but it is
// still user input in a document.
export function esc(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ownerNotifyAddress(): string | null {
  // Blank counts as unset. `??` would have treated OWNER_NOTIFY_EMAIL="" as a
  // real value and silently disabled notification instead of falling back —
  // and blanking a variable rather than deleting it is exactly what people do
  // in a hosting dashboard.
  const first = process.env.OWNER_NOTIFY_EMAIL?.trim();
  if (first) return first;
  const second = process.env.OPS_ALERT_EMAIL?.trim();
  return second || null;
}

export async function notifyOwner(opts: {
  subject: string;
  heading: string;
  /** HTML body. Keep it factual — these are working notes, not marketing. */
  body: string;
  ref: { type: string; rowId: string };
}): Promise<boolean> {
  const to = ownerNotifyAddress();
  if (!to) {
    console.warn(
      `[notify-owner] "${opts.subject}" not sent — neither OWNER_NOTIFY_EMAIL nor OPS_ALERT_EMAIL is set.`,
    );
    return false;
  }
  try {
    await sendEmail({
      to,
      subject: opts.subject,
      html: renderEmail({ centreName: "Equiwings", heading: opts.heading, body: opts.body }),
      ref: opts.ref,
    });
    return true;
  } catch (err) {
    // Never let a notification failure break the thing that triggered it —
    // a signup must still succeed if the owner's mail server is down.
    console.error("[notify-owner] send failed", opts.subject, err);
    return false;
  }
}
