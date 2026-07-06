// Plain-English messages for the SCREAMING_SNAKE error codes the API routes
// return, so non-technical staff never see a raw code in a toast. Unmapped
// codes fall back to a generic line; an explicit `message` from the API always
// wins (routes that already write human text keep it).

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session has expired — please sign in again.",
  UNAUTHORIZED: "Your session has expired — please sign in again.",
  FORBIDDEN: "You don't have permission to do that.",
  FORBIDDEN_SUPER_ADMIN: "Only a Super Admin can do that.",
  FORBIDDEN_CROSS_CENTRE: "You can only do this for your own centre.",
  RIDER_CROSS_CENTRE: "That rider belongs to another centre.",
  FORBIDDEN_CROSS_ORG: "That record belongs to another organisation.",
  VALIDATION: "Some fields need fixing — please check the highlighted ones.",
  VALIDATION_ROWS: "Some rows need fixing — please check the highlighted ones.",
  READ_ONLY: "This account is read-only (billing past due) — writes are paused.",
  RATE_LIMITED: "Too many attempts — please wait a moment and try again.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  BAD_CODE: "That code isn't valid.",
  TOTP_REQUIRED: "Enter your authenticator code to continue.",
  TOTP_INVALID: "That authenticator code is incorrect.",
  TOTP_REPLAY: "That code was already used — wait for the next one.",
  RECOVERY_INVALID: "That recovery code isn't valid.",
  ACCOUNT_SUSPENDED: "This account is suspended — please contact your administrator.",
  NOT_FOUND: "We couldn't find that record — it may have been removed.",
  NO_ORG: "We couldn't determine your organisation — please pick a centre and retry.",
  NO_CENTRE: "Pick a centre first, then try again.",
  NO_CENTRE_CONTEXT: "Pick a centre first, then try again.",
  USER_HAS_NO_CENTRE: "Your account isn't assigned to a centre yet — ask an admin.",
  EMAIL_TAKEN: "That email is already in use.",
  WEAK_PASSWORD: "Please choose a stronger password.",
  NO_CHANGES: "Nothing changed — there was nothing to save.",
  ALREADY_COMPLETED: "That's already been completed.",
  NOT_PENDING: "That request is no longer pending.",
  FEATURE_DISABLED: "That feature isn't enabled for your plan.",
  HORSE_NOT_IN_CENTRE: "That horse belongs to another centre.",
  HORSE_REQUIRED: "Please pick a horse first.",
  DECLARATION_REQUIRED: "Please tick the declaration before submitting.",
  SHIFT_REQUIRED: "Please choose a shift before submitting.",
  RAZORPAY_NOT_CONFIGURED: "Online payments aren't set up yet — contact your admin.",
  PROVIDER_ERROR: "The payment provider had a problem — please try again.",
  ALREADY_PAID: "This invoice has already been paid.",
  INVOICE_NOT_FOUND: "We couldn't find that invoice — it may have been removed.",
  INVALID_AMOUNT: "That amount isn't valid — please refresh and try again.",
  ROLE_INVALID: "Your account role is misconfigured — please contact your administrator.",
};

const GENERIC = "Something went wrong. Please try again.";

// Turn an API JSON payload (or a bare code string) into a human message.
// Preference: explicit `message` → mapped `error`/`code` → generic fallback.
export function humanizeError(payload: unknown, fallback: string = GENERIC): string {
  if (typeof payload === "string") return MESSAGES[payload] ?? fallback;
  if (payload && typeof payload === "object") {
    const p = payload as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof p.message === "string" && p.message.trim()) return p.message;
    const code = typeof p.error === "string" ? p.error : typeof p.code === "string" ? p.code : null;
    if (code) return MESSAGES[code] ?? fallback;
  }
  return fallback;
}
