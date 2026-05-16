// Sentry init scaffold. We deliberately avoid importing @sentry/nextjs at
// module load so the codebase doesn't pull a hard dep that's only useful
// in production. The init function is a no-op until SENTRY_DSN is set.
//
// To activate:
//   1. npm install @sentry/nextjs
//   2. Set SENTRY_DSN in env
//   3. Add `import "@/lib/sentry"; initSentry();` at the top of
//      `app/layout.tsx` and `app/api/cron/sweep/route.ts`
//
// The dynamic require keeps tsc happy in CI where @sentry/nextjs may not
// be installed yet. It's a one-shot pattern — once you commit to Sentry,
// migrate to the standard `sentry.client.config.ts` / `sentry.server.config.ts`
// that @sentry/nextjs's wizard generates and delete this shim.

let initialised = false;

export function initSentry() {
  if (initialised) return;
  initialised = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/nextjs");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "unknown",
      release: process.env.APP_VERSION ?? undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
      // PII filter — strip cookies + auth headers before they hit Sentry.
      beforeSend(event: any) {
        if (event.request?.headers) {
          delete event.request.headers["cookie"];
          delete event.request.headers["authorization"];
        }
        return event;
      },
    });
  } catch (err) {
    // @sentry/nextjs not installed — log once and move on. The app is
    // fully functional without it.
    console.warn("[sentry] init skipped: @sentry/nextjs not installed");
  }
}
