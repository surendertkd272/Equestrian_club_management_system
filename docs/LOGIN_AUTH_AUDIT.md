# Login & Session Audit — 31 Jul 2026

Scope: tenant login (`/api/auth/login`), passwordless email-OTP login, forgot/reset
password, forced password rotation, 2FA, session issue/renewal/revocation, the
middleware route gate, and the separate platform-owner auth domain.

Method: read of every auth file plus a sweep of all 224 `app/api/**/route.ts` files
for missing guards. No tests were executed (`.env` points at live prod and the vitest
setup does `db push --force-reset`).

**Verdict:** the cryptographic and token mechanics are sound — the gaps are in the
*flows around* them. Three of them break real user journeys today.

> **Update — every item in this report is now fixed.** Verified with
> `npx tsc --noEmit` and the full suite: **642 tests across 75 files**, including
> 46 new regression tests in
> [auth-signin-gaps.test.ts](tests/api/auth-signin-gaps.test.ts),
> [email-canonical.test.ts](tests/api/email-canonical.test.ts),
> [rate-limit.test.ts](tests/api/rate-limit.test.ts) and
> [session-hardening.test.ts](tests/api/session-hardening.test.ts). All four
> migrations were applied to a scratch database and their effects inspected.
>
> Two things changed the picture after the original write-up, both recorded in
> full below: **a correction** — B5's claim that anyone could provision an
> organisation was wrong — and **a worse bug found while fixing it**: password
> reset had been silently dead in production. See "Correction and late finding".
>
> ⚠️ **Deploying B7 signs every current user out once.** Tenant tokens are now
> audience-tagged and verification requires the tag, so cookies issued before the
> deploy stop validating. Nobody loses data; everyone signs in again. Worth
> picking a quiet moment.

---

## A. Breaks real user journeys — `FIXED`

### A1 — Changing your password immediately logs you out `BLOCKER` → `FIXED`

[app/api/account/change-password/route.ts:39](app/api/account/change-password/route.ts#L39)
increments `tokenVersion` but never re-issues the session cookie. The user's cookie
still carries the *old* version, and [lib/auth.ts:128](lib/auth.ts#L128) rejects any
JWT whose `tokenVersion` doesn't match the row.

So the very next request after a successful password change resolves to a null
session and every layout bounces to `/login?ended=1`.

Worst on the forced-rotation path. [app/account/rotate/form.tsx](app/account/rotate/form.tsx)
shows "Password set — welcome!" then `router.push(homeOnSuccess)` — straight into a
layout that throws them back to the login screen. **Every new staff member issued a
temp password hits this on their first ever sign-in**, and the message they get
("Your session has ended…") suggests something went wrong rather than "you're done,
sign in again."

**Fixed.** Both change-password routes now re-mint the cookie with the new
`tokenVersion` before returning, so the device that made the change stays signed in
while every other device is signed out (which is the point of the bump).
Impersonation markers are carried across the re-mint. The owner portal had the
identical defect — `getOwnerSession` applies the same `tokenVersion` equality check —
and got the same fix.

### A2 — A tenant user who enables 2FA can never log in with a password again `BLOCKER` → `FIXED`

- The API is complete: [app/api/auth/login/route.ts:80](app/api/auth/login/route.ts#L80)
  returns `401 TWO_FACTOR_REQUIRED` and accepts a `totpCode`.
- The UI is not: password mode in [app/login/form.tsx:69-83](app/login/form.tsx#L69-L83)
  posts only `{email, password}`, renders no authenticator field, and does not handle
  `TWO_FACTOR_REQUIRED`. Only the OTP path has the `needTotp` branch
  ([form.tsx:105](app/login/form.tsx#L105)).
- [lib/error-messages.ts](lib/error-messages.ts) has no entry for `TWO_FACTOR_REQUIRED`
  either (it maps the owner-portal's `TOTP_REQUIRED`, a different code), so the user
  sees the generic **"Something went wrong. Please try again."**

Currently latent: no page in the app calls `/api/account/totp`, so nobody can enrol
from the UI. But the endpoints ship and are reachable — anyone who enrols via the API
locks themselves out of password login permanently.

**Fixed.** The second-factor state is now hoisted and shared by both sign-in modes —
the server applies one gate to both paths, so the form does too. Password mode renders
the authenticator field on challenge, both `TWO_FACTOR_*` codes are mapped to human
copy, and there's a "lost your authenticator? use a recovery code" toggle (the API
already accepted `recoveryCode`; nothing could send one). Blocking-code handling for
both modes lives in a single `handleBlocked()` so they can't drift.

### A3 — Account-deletion grace window is unreachable; users get a sign-in loop `HIGH` → `FIXED`

[app/api/auth/login/route.ts:58](app/api/auth/login/route.ts#L58) checks only
`status !== "active"` — not `deletionRequestedAt`. So login *succeeds* and sets a
cookie. Then [lib/auth.ts:132](lib/auth.ts#L132) nulls the session for exactly that
flag, and every layout bounces to `/login?ended=1`. Sign in → bounce → sign in →
bounce.

`/api/account/delete/cancel` was written for this case and works, but **no page or
component anywhere calls it** (the only grep hits are the route file itself). The
DPDPA promise in the schema comment — "the user can sign in only to cancel the
request" — has no UI behind it.

**Fixed.** A shared `accountStateGate()` in [lib/sign-in.ts](lib/sign-in.ts) now
refuses the sign-in with `403 DELETION_PENDING` plus the erase date, minting no
cookie. Both sign-in routes call it as soon as the user row loads — deliberately
*before* the OTP path consumes the emailed code, so a refused sign-in leaves that code
live — and `finishSignIn()` calls it again as a backstop so a future sign-in path
can't forget it.

The exit is a new public [`POST /api/auth/cancel-deletion`](app/api/auth/cancel-deletion/route.ts):
it re-proves the same factors sign-in demands (password **or** a current emailed code,
plus any second factor), clears the flag, and issues no session — the user then signs
in normally. Accepting the emailed code matters, because OTP sign-in is the path for
people who've forgotten their password and one of them being unable to rescue their
own account is the exact failure being fixed.

The login form renders a "Keep my account" panel on that code, and signs the user
straight in afterwards when nothing single-use was spent proving it. The confirmation
email's instructions were wrong too ("sign in and visit Account Settings" — a page
that cannot load); it now describes what actually happens. The 30-day window is a
single shared constant in [lib/dpdpa.ts](lib/dpdpa.ts), so the date shown to the user
and the date the sweep acts on can't drift.

---

## B. Security gaps

### B1 — Login brute-force protection is close to absent in production `HIGH` → `FIXED`

Two compounding issues:

1. **The limiter is an in-process `Map`** ([lib/rate-limit.ts:11](lib/rate-limit.ts#L11)).
   The file says so itself: "Good enough for one-instance deployments… for
   multi-instance / serverless prod, swap this for Redis." Prod *is* serverless
   (Vercel). Each lambda instance keeps its own counters and cold starts reset them,
   so the real cap is `limit × live instances`, refreshed constantly.
2. **The per-email cap on tenant login is keyed by IP as well** —
   `login:em:${ip}:${email}` ([login/route.ts:42](app/api/auth/login/route.ts#L42)).
   That means credential stuffing spread across IPs gets 5 attempts *per IP* against
   one account, with no global per-account ceiling. Owner login gets this right —
   `owner-login:em:${email}`, email only
   ([owner login:41](app/api/owner/auth/login/route.ts#L41)) — as does forgot-password.

Also worth hardening: `clientFingerprint` ([rate-limit.ts:41](lib/rate-limit.ts#L41))
takes the *first* `x-forwarded-for` entry. That's correct on Vercel today because the
platform overwrites the header, but it's a spoofable key behind any proxy that
appends instead, and the `"unknown"` fallback collapses every caller into one shared
bucket. Prefer `req.ip` / `x-vercel-forwarded-for`.

**Fixed.** The counters now live in Postgres
([lib/rate-limit.ts](lib/rate-limit.ts), `RateLimitCounter`): fixed-window rows
incremented by a single atomic `INSERT .. ON CONFLICT DO UPDATE`, so concurrent
lambdas can't lose a count to a read-modify-write race and a cold start doesn't wipe
the window. Redis would also have worked, but nothing in the Vercel project
provisions one today, and this ships with the infrastructure that already exists.

Chose Postgres over Redis deliberately; the trade-offs, stated rather than buried:
a **fixed** window (not a sliding log) lets a burst straddling a boundary reach up to
2× the limit — one round-trip per check instead of a row per attempt plus a range
scan, which is the right call for throttling guessers. And the DB path **degrades to
the old in-process limiter** if it throws, so a database blip can neither lock every
user out of signing in nor throw the doors open.

The login keys changed too:
- the account cap is keyed on the **address alone** (`login:em:<email>`), so stuffing
  spread across IPs no longer gets a fresh allowance per IP;
- only **failures** count, and a success clears the account counter — otherwise a busy
  centre signing in all morning throttles itself while costing a guesser nothing (the
  IP counter is left alone on success; on a shared NAT it isn't one user's to clear);
- a wrong second factor counts as a failure, so a stolen password doesn't buy
  unlimited guesses at the 6-digit code. A *missing* one is a challenge, not a
  failure, and stays free.

`clientFingerprint` now prefers `req.ip` / `x-vercel-forwarded-for` (platform-set,
unspoofable) and treats `x-forwarded-for` as the last resort rather than the first.
Expired windows are swept by a new `rate_limit_purge` job.

Residual, accepted: an attacker who burns an account's 10 failures locks that user out
for the rest of the 15-minute window. That is the standard trade for having an account
cap at all, and the window is short.

### B2 — Tenant 2FA has no replay protection, though the schema says it does `MEDIUM` → `FIXED`

`User.totpLastStep` exists and its schema comment claims "last-step replay
protection". It is written to `null` on enrol and disable
([account/totp/route.ts:60,92](app/api/account/totp/route.ts#L60)) — and **never set
or compared anywhere else**. [lib/sign-in.ts:39](lib/sign-in.ts#L39) uses the boolean
`verifyTotp`, not `verifyTotpWithStep`.

Owner login implements it properly
([owner login:88-101](app/api/owner/auth/login/route.ts#L88-L101)). The tenant path
should use the same helper — a code observed inside its ±90s window is currently
replayable.

**Fixed.** `twoFactorGate()` now uses `verifyTotpWithStep`, rejects any code whose
step doesn't strictly advance `totpLastStep`, and persists the accepted step —
matching the owner path. A replayed code returns `TWO_FACTOR_REPLAY`, which the login
form surfaces and the rate limiter charges as a failed attempt.

### B3 — Stopping an impersonation mints an unrevocable owner session `MEDIUM` → `FIXED`

[app/api/owner/impersonate/stop/route.ts:37-41](app/api/owner/impersonate/stop/route.ts#L37-L41)
signs the restored owner session **without `tokenVersion`**, and
[lib/owner-auth.ts:84](lib/owner-auth.ts#L84) only runs the status / tokenVersion DB
re-check when a `tokenVersion` is present.

Result: an owner who was suspended or password-reset while impersonating walks back
out with a fully valid owner cookie that survives for its whole TTL and cannot be
revoked. This is the identical bug that was already fixed on the tenant side —
[lib/auth.ts:113](lib/auth.ts#L113) deliberately runs the DB check for impersonation
sessions too. Carry the same fix across.

**Fixed**, and the class closed rather than the instance: the stop route now mints
with `tokenVersion`, *and* `getOwnerSession()` runs its DB re-check
**unconditionally**. A token with no `tokenVersion` is treated as un-revocable and
therefore invalid, instead of being trusted — so a future minting path that forgets
fails shut rather than open. All three owner-minting paths supply one.

### B4 — Logging out doesn't invalidate the token `MEDIUM` → `FIXED`

[app/api/auth/logout/route.ts](app/api/auth/logout/route.ts) only deletes the cookie.
A copy of the JWT — shared machine, synced browser profile, a captured request — stays
valid for the full 8h TTL after the user pressed "Sign out". `sign-out-everywhere`
does bump `tokenVersion`, but ordinary logout is the button users actually press.

**Fixed** with a per-session denylist. Tokens now carry a `jti`; signing out writes it
to `RevokedSession` and `getSession()` rejects any token listed there.

Deliberately *not* a `tokenVersion` bump: that would sign the user out on every
device, and signing out of one laptop shouldn't kill the phone in their pocket —
"sign out everywhere" stays the way to do that on purpose. Renewal carries the `jti`
forward, so a revoked session stays revoked even as middleware re-mints it. Middleware
can't check the denylist (edge, no DB), which is fine: the token dies at
`getSession()`, exactly as `tokenVersion` mismatches already do. Rows are purged by a
new `session_revocation_purge` sweep once the token would have expired anyway.

### B5 — Email verification gates nothing `MEDIUM` → `FIXED` (with a correction)

`emailVerifiedAt` is written by the verify flows and read by nothing. Grep across
`app/` and `lib/` finds only writes, the resend route's already-verified check, and
the data export. The schema comment claims "certain sensitive ops (impersonation
target, password reset trigger) are blocked until verification" — no such check
exists.

> **Correction.** The original write-up went on to claim that "anyone can provision a
> full org and SUPER_ADMIN" via public self-serve signup at `/api/onboarding`. **That
> was wrong.** `provisionTenant()` is called from exactly one place —
> [/api/owner/tenants](app/api/owner/tenants/route.ts) — which requires a platform-owner
> session. There is no public org signup. `/api/onboarding` is public *rider
> enrolment*: it creates a `Rider` row in `pending_approval`, not a login. I checked
> the caller graph before writing the fix, not before writing the finding.
>
> The rest of B5 stands: `emailVerifiedAt` really did gate nothing.

**Fixed.** `accountStateGate()` now refuses a sign-in with `403 EMAIL_UNVERIFIED` for an
account that never proved its address, and the login form sends the user to
`/verify-email?email=…` — the page that already existed for the code they were already
being sent.

The hard part was making "never proved" distinguishable from "predates the check", so
that turning the gate on locks nobody out:

- a [backfill migration](prisma/migrations/20260801103000_backfill_email_verified/migration.sql)
  stamps every pre-existing row with its own `createdAt`, skipping only rows with a
  live unconsumed code (those are genuinely mid-verification);
- admin-created users are stamped at creation across all six creation paths — a
  signed-in admin typing the address *is* the check;
- the email-OTP sign-in path is exempt via `emailProven`, because receiving a code at
  that address is itself proof — and it runs before the code is consumed, so the gate
  can't eat it.

That leaves the tenant-provisioned super admin, who gets a code emailed the moment the
account exists. Verified against the scratch database: after the backfill, **133
verified, 0 unverified** — no existing account changes behaviour.

The failure mode is soft by design: if some creation path was missed, that user sees
"confirm your email" and a working resend, not a lockout.

Also fixed here: the schema comment for `emailVerifiedAt` described the flag
**backwards** ("Null when a verified email is on file"). The code has always been the
other way round — non-null means verified.

**Not done, deliberately:** adding a CAPTCHA to public rider enrolment. That was
proposed on the strength of the mistaken "anyone can create an org" claim. What it
actually protects is a parent-facing enrolment form whose rate limit carries an
explicit comment about not punishing a parent who mistypes her phone number three
times — and which B1 just made properly enforceable for the first time. Adding
friction there is a product call, not a security fix; say the word and it's a
ten-minute change.

### B6 — No absolute session lifetime `LOW` → `FIXED`

[middleware.ts:15-33](middleware.ts#L15-L33) re-mints the cookie past its half-life on
any request, carrying claims forward with a fresh 8h expiry. An account touched once a
day never expires. There's no absolute ceiling and no step-up re-authentication for
sensitive actions.

**Fixed.** Tokens carry `sst` (session start time) — the one timestamp renewal does
*not* move, unlike `iat`. `getSession()` rejects a session older than
`SESSION_ABSOLUTE_MAX_DAYS` (default 30) and middleware stops renewing at the same
point, so it never hands out a cookie that is already dead on arrival.

Step-up re-authentication for sensitive actions is still not implemented; changing a
password and disabling 2FA each require re-proving a factor, which covers the sharpest
cases.

### B7 — Tenant JWTs are not audience-checked `LOW` → `FIXED`

[lib/owner-auth.ts:3](lib/owner-auth.ts#L3) states the audience claim means an owner
token "can never be reused as a tenant session (and vice versa)". Only one direction
holds: owner verification passes `{ audience: OWNER_AUDIENCE }`
([owner-auth.ts:54](lib/owner-auth.ts#L54)), tenant `verifySession`
([lib/auth.ts:62](lib/auth.ts#L62)) passes no audience and accepts any HS256 token
signed with the same key.

Inert in prod — `OWNER_JWT_SECRET` is set separately on both Preview and Production,
so the keys differ. It matters for local dev and any self-host where only
`JWT_SECRET` is set. One-line fix: mint tenant tokens with a `tenant` audience and
verify it.

**Fixed.** Tenant tokens are minted with `aud: "tenant"` and both `verifySession()` and
the middleware now require it, so the claim the owner module always made is finally
true in both directions.

⚠️ This invalidates every cookie issued before the deploy — one forced re-login for
everyone, no data affected.

### B8 — Enumeration timing oracle, and a failed-login dashboard that always reads zero `LOW` → `FIXED`

- [login/route.ts:58](app/api/auth/login/route.ts#L58) returns before the bcrypt
  compare for unknown or inactive users. A real account with a wrong password costs a
  bcrypt round (~60–100 ms). The error bodies match, the timings don't. Compare
  against a dummy hash to flatten it.
- Nothing anywhere writes an `auth.login_failed` audit row, but
  [lib/system-status.ts:52-57](lib/system-status.ts#L52-L57) counts them for the ops
  dashboard's "failed logins (24h)" tile. That tile is permanently 0. There's no
  successful-login audit trail either — no way to answer "when did this account last
  sign in, and from where."

**Fixed.** `equalizePasswordTiming()` burns an equivalent bcrypt round before answering
`INVALID_CREDENTIALS` for an unknown or inactive account, so the response time no
longer distinguishes what the identical response bodies already refuse to.

`auditSignIn()` writes `auth.login_failed` (with a reason — `unknown_email`,
`bad_password`, `bad_totp`, `totp_replay`) and `auth.login_succeeded`, carrying IP and
user-agent. The dashboard tile reads real numbers now, and there is finally an answer
to "when did this account last sign in, and from where". Success is recorded inside
`finishSignIn()` so both sign-in paths are covered; failures go through the single
`failCredentials()` chokepoint the rate limiter already uses. `AuditLog` carries a
permissive RLS policy, so these writes work on the pre-auth path where no org is
bound.

---

## Correction and late finding

Two things the original audit got wrong, both found while implementing the fixes.

### The B5 provisioning claim was wrong

I reported that anyone could provision an organisation and a SUPER_ADMIN through
public self-serve signup. They cannot: tenant provisioning requires a platform-owner
session. The full correction is in B5 above. I asserted a security hole from a route
name without following the caller graph — the kind of claim that should have been
checked before it was written down, not after.

### Password reset was dead in production `HIGH` → `FIXED`

Not in the original report, and worse than several things that were.

[/api/auth/forgot-password](app/api/auth/forgot-password/route.ts#L38-L45) hard-requires
a solved CAPTCHA when `NODE_ENV === "production"` — and returns its no-enumeration
`200` when one is missing. `lib/captcha.ts` and `/api/captcha` both existed and worked.
**Nothing ever rendered the challenge.** No client in the codebase sent
`captchaToken`/`captchaAnswer`.

So in production every reset request hit the early return, no email was sent, and the
form said *"Check your email. If … is on file, a reset link is on its way."* The
no-enumeration design that makes this endpoint safe is exactly what made the failure
invisible — it cannot tell you it did nothing.

I originally cited this route approvingly, as the contrast case that "does CAPTCHA-gate
in production". It was gating, and gating everyone out.

**Fixed** by writing the missing half: [components/captcha-field.tsx](components/captcha-field.tsx)
fetches a challenge, renders it, and submits token + answer; the forgot-password form
now sends them and keeps the submit button disabled until it has both. The owner
forgot-password route has no CAPTCHA gate and was never affected.

### Preview and Production shared a database — and it bit during this work

`vercel.json` ran `prisma migrate deploy` on **every** build, and Preview's
`DIRECT_URL` was byte-identical to Production's. So any push to any branch applied
that branch's migrations to the live database.

That is not hypothetical: it happened while remediating this audit. The branch was
pushed with `[skip ci]` specifically to avoid it, **Vercel built it anyway**, and
deployment `p8uazyqpt` applied all four migrations to production — before any merge or
review. The guard added 16 minutes later worked (the next preview build logged
`skipping migrate deploy (VERCEL_ENV=preview)`), but by then it had already run.

What actually landed on production, and what was done about it:

| Change | Effect on the running (old) code | Action |
|---|---|---|
| `RateLimitCounter`, `RevokedSession` created | Inert — old code never touches them | Left in place |
| `emailVerifiedAt` backfilled | Inert — nothing read the column | Left in place |
| `User.email` lowercased (1 row) | That user must now type their address in lowercase | Left — it is the intended end state |
| `CHECK (email = lower(email))` on both tables | **Live break.** Old code writes emails as typed, so an admin creating `Rahul@Club.in` would hit a constraint violation | **Dropped**, and the migration row deleted so it re-applies at merge with the code that guarantees lowercase writes |

Production was verified healthy afterwards, mixed-case writes accepted again, and
`prisma migrate status` shows the one migration correctly pending.

**Fixed properly now**, two ways:

1. `vercel.json` only runs `prisma migrate deploy` when `VERCEL_ENV=production`, so a
   preview build can no longer alter any schema. Confirmed in a real build log.
2. Preview has its own database. `equiwings_preview` was created on the same instance
   and fully migrated (all 42 migrations from empty), and Preview's `DATABASE_URL` and
   `DIRECT_URL` are now separate records pointing at it — `DIRECT_URL` had been a
   single record shared with Production and is now split.

Remaining caveat: the preview database lives on the same Supabase instance and its URL
carries the same superuser credential, so it shares compute and connection limits and
is not a credential boundary. A dedicated low-privilege role, or a separate Supabase
project, would close that.

---

## C. Correctness & consistency

### C1 — Email is case-sensitive on login, case-insensitive on OTP `MEDIUM` → `FIXED`

| Path | Lookup |
|---|---|
| Password login ([route.ts:52](app/api/auth/login/route.ts#L52)) | exact match |
| Forgot-password ([route.ts:59](app/api/auth/forgot-password/route.ts#L59)) | exact match |
| OTP request / verify | `.toLowerCase()` first |

Nothing normalises email at creation either — [users/route.ts:129](app/api/users/route.ts#L129),
the staff-onboarding routes, and [lib/tenant-provision.ts:90](lib/tenant-provision.ts#L90)
all store it as typed, and Postgres `@unique` is case-sensitive. Three consequences:

1. A user stored as `Rahul@Club.in` who types `rahul@club.in` gets "Incorrect email or password."
2. That same user can *never* use email-code login — it lowercases and finds nobody.
3. `Rahul@Club.in` and `rahul@club.in` can coexist as two separate accounts.

**Fixed.** `normalizeEmail()` / `emailIdentity()`
([lib/email-normalize.ts](lib/email-normalize.ts)) canonicalise at the **zod parse
boundary**, so the lookup, the rate-limit key and the insert downstream all see one
form and can't drift from each other. Applied across every schema that carries a login
identity, plus the handful of sites that take the address off a DB row or a CSV
instead of a request body.

Case and surrounding whitespace only — no dot-stripping or plus-tag removal, which are
provider-specific conventions; folding `a+club@gmail.com` into `a@gmail.com` would
merge accounts their owner considers separate. `.trim()` runs **before** `.email()`,
because zod checks in declaration order and an address pasted out of a mail client
routinely carries a trailing space (validating first rejected those as "Invalid
email" — caught by a test, not by reading).

The [migration](prisma/migrations/20260801090000_lowercase_login_emails/migration.sql)
backfills existing rows and adds `CHECK (email = lower(email))` to both tables, so a
future call site that forgets fails loudly at the database instead of quietly minting
a shadow account. Production was checked first: 70 users, 1 mixed-case row, **zero**
addresses that collide once lowercased, so the backfill can't trip the unique index
there.

Out of scope, deliberately: `Rider.email`, vendor and parent *profile* columns are
contact details rather than login identities and were left alone.

### C2 — Owner and tenant session TTLs share one env var `LOW` → `FIXED`

[lib/auth.ts:52](lib/auth.ts#L52) defaults to 480 min, [lib/owner-auth.ts:43](lib/owner-auth.ts#L43)
to 60 — but both read `JWT_ACCESS_TTL_MIN`. Setting it to tune tenant sessions
silently retunes the highest-value session in the system. It's currently unset in
prod, so the split defaults hold.

Related: owner sessions get no sliding renewal (middleware treats `/owner` as public
and returns at [middleware.ts:128](middleware.ts#L128)), so owners hard-drop at 60
minutes mid-task with no warning.

**Fixed.** Owner sessions read their own `OWNER_JWT_TTL_MIN` (default 60), so tuning
the tenant window no longer silently retunes the highest-value session on the platform.
And they now slide-renew: the middleware refreshes the owner cookie on owner paths
while never gating on it — `/owner/*` and `/api/owner/*` keep enforcing themselves via
`getOwnerSession()`.

---

## D. What checks out

- **Route coverage.** Swept all 224 API route files: every one without an auth helper
  is a deliberately public endpoint (auth, captcha, health, public registration,
  payment order). No accidental holes. `/api/upload` correctly branches — anon only
  for onboarding upload kinds, `getSession()` for everything else.
- **Open redirect.** `?next=` is properly validated —
  [lib/safe-redirect.ts](lib/safe-redirect.ts) rejects protocol-relative, backslash,
  and control-character payloads.
- **Password reset tokens.** 24 random bytes, SHA-256 at rest, single-use via an
  `updateMany` race guard, 30-min TTL, bumps `tokenVersion`, and deliberately does not
  auto-login.
- **Email OTP.** CSPRNG 6-digit, hashed, 10-min TTL, 5-attempt cap, issuing a new code
  retires the live one, and peek-then-consume means a 2FA round-trip doesn't burn the
  code.
- **Owner portal.** Separate cookie, `sameSite: strict`, distinct audience and secret,
  TOTP replay protection, recovery codes hashed and consumed. Every `/api/owner/*`
  route is guarded except the four intentionally public auth endpoints.
- **Session resolution.** `getSession` re-reads `centreId` from the row rather than
  trusting the JWT snapshot (the transferred-staff fix), enforces suspended-org,
  deactivation, deletion and impersonation-expiry, binds org for RLS, and is
  `React.cache()`d so it costs one DB round-trip per render.
- **Cookies.** `httpOnly`, `secure` in production; tenant `sameSite: lax` is a
  defensible trade for deep links.
- **Prod config.** `NEXT_PUBLIC_SHOW_TEST_DROPDOWN` is *not* set in Vercel production
   — the dev quick-pick dropdown, the "all passwords are `password`" hint, and the
  rate-limit bypass at [login/route.ts:32](app/api/auth/login/route.ts#L32) are all
  correctly off.

---

## Status

Every item in the report is fixed. Order they were done in:

| # | Item | Status |
|---|---|---|
| 1 | A1 — re-issue cookie on password change | **done** |
| 2 | A3 — deletion-pending login loop | **done** |
| 3 | A2 — TOTP field in the password form | **done** |
| 4 | C1 — normalise email casing | **done** |
| 5 | B1 — durable rate limit + per-account cap | **done** |
| 6 | B3 — owner sessions always revocable | **done** |
| 7 | B2 — TOTP replay protection on tenant login | **done** |
| 8 | B8 — timing equalisation + sign-in audit trail | **done** |
| 9 | B4 — per-session revocation on sign-out | **done** |
| 10 | B6 — absolute session lifetime | **done** |
| 11 | B7 — audience-tagged tenant tokens | **done** |
| 12 | C2 — separate owner TTL + owner sliding renewal | **done** |
| 13 | B5 — email-verification gate (see correction) | **done** |
| — | Password reset dead in production (late finding) | **done** |
| — | CAPTCHA on public rider enrolment | not done — see B5, product call |

### Before deploying

- **B7 forces one re-login for everyone.** Audience-tagged tokens invalidate cookies
  issued before the deploy. No data is affected; pick a quiet moment.
- **Four migrations ship with this**, applied by `prisma migrate deploy` on the
  Vercel build: lowercase login emails (+ CHECK constraint), `RateLimitCounter`,
  `RevokedSession`, and the `emailVerifiedAt` backfill.

- ⚠️ **Three of the four are ALREADY applied to production.** A preview build of the
  first push ran the then-unguarded `prisma migrate deploy` against the shared
  database before `vercel.json` was fixed. `migrate deploy` will skip those three at
  merge (they are recorded in `_prisma_migrations`); only
  `20260801090000_lowercase_login_emails` is pending, having been deliberately
  unwound. See "Preview and Production shared a database" below.
- **Optional new env vars**, all with working defaults: `OWNER_JWT_TTL_MIN` (60),
  `SESSION_ABSOLUTE_MAX_DAYS` (30).
- **One residual, accepted:** an attacker who burns an account's 10 login failures
  locks that user out for the rest of the 15-minute window. Standard trade for having
  a per-account cap at all.
