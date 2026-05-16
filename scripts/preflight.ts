// scripts/preflight.ts — pre-deploy env validation.
//
// Run with:  npm run preflight
// or:        NODE_ENV=production npm run preflight
//
// Exits 0 when nothing fails. Exits 1 if any FAIL appears. Warnings (orange)
// are advisory only — they print but don't change the exit code.
//
// The point: catch missing keys before they cause first-customer-day
// surprises. Webhooks don't deliver if the secret is unset. SMS dry-runs
// silently. Email goes nowhere. This script makes those states loud.

// Minimal .env loader so the script works in dev without a dep on dotenv.
// In production (Vercel / Railway) env vars are already in process.env,
// so this is a no-op then. We deliberately don't override existing keys.
import fs from "node:fs";
import path from "node:path";
function loadEnvFile(p: string) {
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env.production"));

type Severity = "ok" | "warn" | "fail";
type Result = { name: string; severity: Severity; detail?: string };

const PROD = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
const results: Result[] = [];

function ok(name: string, detail?: string) {
  results.push({ name, severity: "ok", detail });
}
function warn(name: string, detail?: string) {
  results.push({ name, severity: "warn", detail });
}
function fail(name: string, detail?: string) {
  results.push({ name, severity: "fail", detail });
}

function required(name: string, value: string | undefined, hint?: string) {
  if (value && value.trim().length > 0) {
    ok(name, value.length > 80 ? `${value.slice(0, 40)}…(${value.length} chars)` : value);
  } else if (PROD) {
    fail(name, hint ?? "required in production");
  } else {
    warn(name, hint ?? "not set (ok in dev)");
  }
}

function softRequired(name: string, value: string | undefined, hint?: string) {
  if (value && value.trim().length > 0) {
    ok(name);
  } else {
    warn(name, hint ?? "not set — feature will dry-run / be disabled");
  }
}

// ─── Core ───────────────────────────────────────────────────────────────────
{
  const db = process.env.DATABASE_URL ?? "";
  if (!db) {
    fail("DATABASE_URL", "missing");
  } else if (PROD && db.startsWith("file:")) {
    fail("DATABASE_URL", "production cannot run on SQLite — switch to Postgres");
  } else if (PROD && !db.includes("pgbouncer") && !db.includes("pooler") && !db.includes("proxy")) {
    warn("DATABASE_URL", "no pooler hint in URL — verify you're using pgbouncer/RDS Proxy");
  } else {
    ok("DATABASE_URL", db.slice(0, 40) + "…");
  }
}

{
  const s = process.env.JWT_SECRET ?? "";
  if (!s) fail("JWT_SECRET", "missing");
  else if (s.length < 32) fail("JWT_SECRET", `${s.length} chars; need 32+`);
  else if (s.includes("dev-only")) {
    if (PROD) fail("JWT_SECRET", "still using the dev placeholder");
    else warn("JWT_SECRET", "dev placeholder");
  } else ok("JWT_SECRET", `${s.length} chars`);
}

{
  const s = process.env.OWNER_JWT_SECRET ?? "";
  if (!s) fail("OWNER_JWT_SECRET", "missing");
  else if (s.length < 32) fail("OWNER_JWT_SECRET", `${s.length} chars; need 32+`);
  else if (s === process.env.JWT_SECRET) fail("OWNER_JWT_SECRET", "must differ from JWT_SECRET");
  else ok("OWNER_JWT_SECRET");
}

{
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!url) fail("NEXT_PUBLIC_APP_URL", "missing");
  else if (PROD && !url.startsWith("https://")) fail("NEXT_PUBLIC_APP_URL", "production must be HTTPS");
  else ok("NEXT_PUBLIC_APP_URL", url);
}

// ─── Cron ───────────────────────────────────────────────────────────────────
required("CRON_SECRET", process.env.CRON_SECRET, "without this, /api/cron/sweep is unreachable");

// ─── Email ──────────────────────────────────────────────────────────────────
{
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!key || !from) {
    if (PROD) fail("Email (SendGrid)", "SENDGRID_API_KEY + SENDGRID_FROM_EMAIL required");
    else warn("Email (SendGrid)", "not set — emails dry-run to console");
  } else {
    ok("Email (SendGrid)", from);
  }
}

// ─── SMS / WhatsApp ─────────────────────────────────────────────────────────
{
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    if (PROD) warn("SMS (Twilio)", "missing — fee/exam SMS will dry-run. Required if you sell on India SMS workflows.");
    else warn("SMS (Twilio)", "not set — dry-run only");
  } else {
    ok("SMS (Twilio)", from);
  }
}

{
  const url = process.env.WHATSAPP_PROVIDER_URL;
  const key = process.env.WHATSAPP_API_KEY;
  if (!url || !key) {
    warn("WhatsApp", "not set — WA messages dry-run");
  } else {
    ok("WhatsApp", url);
  }
}

// ─── Billing ────────────────────────────────────────────────────────────────
{
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const webhook = process.env.RAZORPAY_WEBHOOK_SECRET;
  const publicId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  if (!id || !secret) {
    if (PROD) fail("Razorpay credentials", "RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET required for INR billing");
    else warn("Razorpay credentials", "not set — onboarding wizard falls back to mock");
  } else {
    ok("Razorpay credentials");
    if (!webhook) {
      if (PROD) fail("RAZORPAY_WEBHOOK_SECRET", "without this, webhooks are rejected");
      else warn("RAZORPAY_WEBHOOK_SECRET", "not set");
    } else ok("RAZORPAY_WEBHOOK_SECRET");
    if (publicId !== id) {
      fail("NEXT_PUBLIC_RAZORPAY_KEY_ID", "must equal RAZORPAY_KEY_ID (browser needs it)");
    }
  }
}

{
  const tiers = [
    { name: "RAZORPAY_PLAN_STARTER", value: process.env.RAZORPAY_PLAN_STARTER },
    { name: "RAZORPAY_PLAN_PRO", value: process.env.RAZORPAY_PLAN_PRO },
    { name: "RAZORPAY_PLAN_ENTERPRISE", value: process.env.RAZORPAY_PLAN_ENTERPRISE },
  ];
  const missing = tiers.filter((t) => !t.value);
  if (missing.length > 0) {
    if (PROD) {
      fail("Razorpay plan IDs", `missing: ${missing.map((m) => m.name).join(", ")}. Create plans in dashboard then paste IDs.`);
    } else {
      warn("Razorpay plan IDs", "not all set — subscription create will refuse for missing tiers");
    }
  } else {
    ok("Razorpay plan IDs", "all 3 tiers configured");
  }
}

{
  const key = process.env.STRIPE_SECRET_KEY;
  const webhook = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key) {
    warn("Stripe", "not set — optional for India launch, required for international cards");
  } else {
    ok("Stripe");
    if (!webhook) fail("STRIPE_WEBHOOK_SECRET", "set if STRIPE_SECRET_KEY is set");
  }
}

// ─── Storage ────────────────────────────────────────────────────────────────
{
  const bucket = process.env.S3_BUCKET;
  const key = process.env.S3_ACCESS_KEY;
  const sec = process.env.S3_SECRET;
  const pub = process.env.S3_PUBLIC_URL;
  if (!bucket || !key || !sec || !pub) {
    if (PROD) fail("S3 storage", "production must use S3 — uploads written to local FS will be ephemeral");
    else warn("S3 storage", "not set — uploads land in public/uploads (dev only)");
  } else {
    ok("S3 storage", `${bucket} @ ${pub}`);
  }
}

// ─── Observability ──────────────────────────────────────────────────────────
softRequired("SENTRY_DSN", process.env.SENTRY_DSN, "no Sentry → operating blind in prod");
softRequired("APP_VERSION", process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA, "no version → harder to correlate Sentry events to deploys");

// ─── Output ────────────────────────────────────────────────────────────────
const ANSI = process.stdout.isTTY ? { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", reset: "\x1b[0m", dim: "\x1b[2m" } : { red: "", yellow: "", green: "", reset: "", dim: "" };
function tag(s: Severity) {
  if (s === "ok") return `${ANSI.green}✓${ANSI.reset}`;
  if (s === "warn") return `${ANSI.yellow}!${ANSI.reset}`;
  return `${ANSI.red}✗${ANSI.reset}`;
}

console.log(`\nPre-flight check · NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}\n`);
for (const r of results) {
  const detail = r.detail ? ` ${ANSI.dim}— ${r.detail}${ANSI.reset}` : "";
  console.log(`  ${tag(r.severity)} ${r.name}${detail}`);
}

const okCount = results.filter((r) => r.severity === "ok").length;
const warnCount = results.filter((r) => r.severity === "warn").length;
const failCount = results.filter((r) => r.severity === "fail").length;

console.log(`\n${okCount} OK · ${warnCount} warning${warnCount === 1 ? "" : "s"} · ${failCount} fail${failCount === 1 ? "" : "s"}\n`);

if (failCount > 0) {
  console.log(`${ANSI.red}Refusing deploy — fix the ✗ items first.${ANSI.reset}\n`);
  process.exit(1);
}
if (warnCount > 0 && PROD) {
  console.log(`${ANSI.yellow}Production launch with warnings — review the ! items.${ANSI.reset}\n`);
}
process.exit(0);
