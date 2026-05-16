# Equiwings Central Admin Panel

Phase-1 build from `Equiwings_Central_Admin_Panel_Spec.md`. Multi-tenant equestrian-centre management — riders, horses, vet, exams, competitions, certificates, reports, and analytics all on one runnable Next.js app.

## What's in this build

All Phase-1 spec sections (§4.1–§4.23) have working UI and proven end-to-end flows.

| Module | Status |
|---|---|
| §4.1 Rider Onboarding (digital form + e-sign indemnity + Razorpay) | ✓ |
| §4.2 Attendance (kanban-style daily marking, batches) | ✓ |
| §4.3 Progress Monitoring (per-skill checklist + cohort heatmap) | ✓ |
| §4.4 / §4.16–4.19 Exams (scheduling, scoring engine ported from exam module, templates) | ✓ |
| §4.5 Monthly Parent Report Card (print/PDF) | ✓ |
| §4.6 / §4.14 Competitions + Public live scoreboard | ✓ |
| §4.7 Performance Analytics (trends, medal leaderboard, level distribution) | ✓ |
| §4.8 Staff onboarding | ✓ |
| §4.8b Staff Attendance + Leave Requests (PRD §4 Module 2) | ✓ |
| Parent Portal (PRD §3 / Phase 2) — read-only child view, scoped via ParentLink | ✓ |
| §4.9 Tasks (kanban, overdue/escalation, recurrence label, completion proof) | ✓ |
| §4.10 / §4.11 Tack & Equipment (QR scan → issue/return + maintenance) | ✓ |
| §4.12 Vet Medicines (inventory, prescribe, withdrawal → horse rest) | ✓ |
| §4.13 Horse Roster + Workload + Allocations (4h daily cap, overlap detection) | ✓ |
| §4.20 Fee + Razorpay (mock fallback or real hosted checkout) | ✓ |
| §4.21 Certificates auto-issue + public QR verify | ✓ |
| §4.22 Notifications (in-app feed + bell + 5 wired triggers) | ✓ |
| §4.23 Audit Log | ✓ |
| §5 Dashboards (HQ cross-centre + centre KPI tiles) | ✓ |
| §8 Public verify URL (printable QR on every cert) | ✓ |

**Cross-module integrations proven by smoke test**
- Medicine withdrawal → horse `rest` → allocation API refuses lessons
- Exam pass → certificate auto-issued + rider level bumped + `/verify/[serial]` lights up
- Damaged tack return → maintenance ticket auto-opens + manager notification fires
- Onboarding → centre-manager notification; task assignment → assignee notification

## Quick start

```bash
# 1. Install
npm install

# 2. Generate Prisma client + create SQLite DB
npx prisma db push

# 3. Seed sample data (org, centre, users, batches, horses, meds, skills, scoring templates)
npm run db:seed

# 4. Run
npm run dev
```

Then open **http://localhost:3000**.

### Default login credentials

After `npm run db:seed`, you get:

**HQ** — one super admin sitting above all 4 clubs.

| Role | Email | Password |
|---|---|---|
| Super Admin (HQ) | `super@equiwings.in` | `password` |

**Per-club stakeholders** — every club has the same 12 accounts. Email pattern: `<role>.<slug>@equiwings.in`. Pick any one club's slug below.

| Slug | Club | Onboarding URL |
|---|---|---|
| `ghaziabad` | Equiwings Ghaziabad | `/onboarding?centre=ghaziabad` |
| `gurgaon` | Equiwings Gurgaon | `/onboarding?centre=gurgaon` |
| `mumbai` | Equiwings Mumbai | `/onboarding?centre=mumbai` |
| `bangalore` | Equiwings Bangalore | `/onboarding?centre=bangalore` |

| Role | Email pattern | Notes |
|---|---|---|
| Centre Manager | `manager.<slug>@equiwings.in` | full centre admin |
| Head Coach | `headcoach.<slug>@equiwings.in` | senior trainer |
| Coach | `coach.<slug>@equiwings.in` | day-to-day instructor |
| Vet | `vet.<slug>@equiwings.in` | medicine + horse health |
| Examiner | `examiner.<slug>@equiwings.in` | scores exams + issues certs |
| Stable Manager | `stablemanager.<slug>@equiwings.in` | stable + tack ops |
| Inventory Manager | `inventorymanager.<slug>@equiwings.in` | tack + medicine stock |
| Competition Manager | `competitionmanager.<slug>@equiwings.in` | tournament planning |
| Groom | `groom.<slug>@equiwings.in` | grooming + feeding tasks |
| Farrier | `farrier.<slug>@equiwings.in` | shoeing specialist |
| Accountant | `accountant.<slug>@equiwings.in` | finance read/write |
| Parent | `parent.<slug>@equiwings.in` | parent portal — linked to first sample rider in that club |

All passwords are `password`. The seed creates 1 + (12 × 4) = **49 accounts** total.

### Public flows (no login)

- **Onboarding wizard** — http://localhost:3000/onboarding?centre=ghrc
- **Certificate verification** — http://localhost:3000/verify/EW-L1-XXXXXXXX (issued certs only)
- **Tack QR scan** — http://localhost:3000/tack/by-code/EW-TACK-XXXXXX (auth-bounced)
- **Live competition scoreboard** — http://localhost:3000/events/SLUG/live (when status=live)

## Payments — Razorpay setup

The onboarding wizard's "Pay" step branches at runtime:
- If `NEXT_PUBLIC_RAZORPAY_KEY_ID` is set → opens real Razorpay Checkout (UPI / cards / netbanking)
- Otherwise → falls back to `/api/payments/razorpay/mock` which auto-flips the invoice to paid

### Going live

1. **Create test/live keys** at https://dashboard.razorpay.com → Settings → API Keys
2. **Set environment variables** in `.env`:
   ```
   RAZORPAY_KEY_ID="rzp_test_xxx"
   RAZORPAY_KEY_SECRET="xxx"
   RAZORPAY_WEBHOOK_SECRET="xxx"      # generated below
   NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_xxx"  # same as RAZORPAY_KEY_ID
   ```
3. **Add a webhook** at https://dashboard.razorpay.com → Settings → Webhooks
   - URL: `https://YOUR_HOST/api/webhooks/razorpay`
   - Active events: `payment.captured`
   - Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`

### Flow

```
Client (onboarding wizard)
   │
   │ POST /api/payments/razorpay/order  { invoiceId }
   ▼
Server: createOrder() → Razorpay /v1/orders     ─── notes embed invoiceId
   │
   │ { orderId, keyId, amount }
   ▼
Client: opens Razorpay Checkout modal
   │
   │ user pays
   ▼
Razorpay → handler(response)
   │
   │ POST /api/payments/razorpay/verify
   │  { invoiceId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
   ▼
Server: HMAC verify → mark invoice paid (transactional)
                    → activate rider (if registration fee)
                    → audit log
                    → notify centre manager

   In parallel (or if user closed browser):
Razorpay → POST /api/webhooks/razorpay  (HMAC-signed by webhook secret)
Server: idempotent — no-op if /verify already ran
```

Both paths are HMAC-verified server-side. `Payment.txnRef = razorpay_payment_id` is the dedup key.

## Swapping SQLite → Postgres for production

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
2. Update `DATABASE_URL` in `.env` to a Postgres URL.
3. Run `npx prisma migrate dev --name init`.

The schema uses Prisma-portable types (Json columns are stored as TEXT on SQLite and JSONB on Postgres), so the swap is mechanical.

## Project layout

```
app/
  (admin)/             # Authenticated shell: dashboard, riders, attendance, exams, vet,
                       # horses, tack, competitions, reports, analytics, etc.
  api/
    auth/              # login / logout
    onboarding/        # public rider sign-up POST
    payments/razorpay/ # order / verify / mock
    webhooks/razorpay/ # async payment webhook (HMAC-signed)
    [+ ~20 other API routes for tasks, exams, medicines, horses, etc.]
  events/[slug]/live/  # public competition scoreboard
  onboarding/          # public 6-step rider wizard
  tack/by-code/[code]/ # public QR scan landing
  verify/[serial]/     # public certificate verify
  login/               # public sign-in
components/
  ui/                  # shadcn-style: button, input, card, badge, label, select, textarea
  shell/               # sidebar, topbar (with notification bell)
  charts/              # bar-chart, sparkline (no chart lib — pure CSS + inline SVG)
  scoring/             # scoring-engine (ported from exam module, Tailwind-ified)
lib/
  prisma.ts            # singleton Prisma client
  auth.ts              # JWT (jose) + bcryptjs + httpOnly cookies
  permissions.ts       # role → permission matrix (§3)
  tenancy.ts           # scopeCentre + centreWhere helpers
  audit.ts             # audit-log writer (§4.23)
  notify.ts            # in-app notification helpers (single + role broadcast)
  cert.ts              # serial generator + QR SVG renderer
  razorpay.ts          # order + signature verify (no SDK dep)
  utils.ts             # cn, calcBmi, formatDate, maskAadhaar
  schemas/             # zod validators per module
middleware.ts          # JWT-protected routes
prisma/
  schema.prisma        # full data model (§6) — ~30 models
  seed.ts              # sample org/centre/users/batches/horses/meds/skills/templates
```

## Multi-tenancy

- Every centre-scoped row carries `centreId`.
- `lib/tenancy.ts → scopeCentre()` returns the user's `centreId`, except Super Admin (who sees all centres and can pass `?centre=<id>` to scope).
- The API rejects cross-centre access via per-route checks; middleware enforces auth at the edge; row-level Postgres policies are the recommended second line of defence in prod.

## Where each spec section lives

| Spec § | File / route |
|---|---|
| §3 Roles & Permissions | `lib/permissions.ts` (8 roles × ~20 permissions) |
| §4.1 Rider Onboarding | `app/onboarding/`, `app/api/onboarding/route.ts`, `app/(admin)/riders/` |
| §4.2 Attendance | `app/(admin)/attendance/`, `app/api/attendance/mark/` |
| §4.3 Progress | `app/(admin)/progress/`, `app/(admin)/riders/[id]/progress/` |
| §4.4 / §4.16–4.19 Exams | `app/(admin)/exams/`, `components/scoring/` |
| §4.5 Reports | `app/(admin)/reports/[riderId]/` (print-friendly A4) |
| §4.6 / §4.14 Competitions | `app/(admin)/competitions/`, `app/events/[slug]/live/` |
| §4.7 Analytics | `app/(admin)/analytics/`, `app/(admin)/riders/[id]/analytics/` |
| §4.9 Tasks | `app/(admin)/tasks/` |
| §4.10 / §4.11 Tack | `app/(admin)/tack/`, `app/tack/by-code/[code]/` |
| §4.12 Vet | `app/(admin)/medicines/` |
| §4.13 Horses | `app/(admin)/horses/` |
| §4.20 Fee | `app/(admin)/finance/`, `app/api/payments/razorpay/` |
| §4.21 Certificates | `app/(admin)/certificates/`, `app/verify/[serial]/` |
| §4.22 Notifications | `app/(admin)/notifications/`, `lib/notify.ts` (bell in topbar) |
| §4.23 Audit | `lib/audit.ts`, `app/(admin)/audit/` |
| §5 Dashboards | `app/(admin)/dashboard/` |
| §6 Schema | `prisma/schema.prisma` |
| §9 Security | JWT (jose), httpOnly cookies, bcrypt, Aadhaar masking, HMAC payment verify |

## Scheduled jobs (cron sweeps)

Four sweeps are wired and run via a single shared-secret endpoint at `/api/cron/sweep`:

| Job | What it does | Triggers when |
|---|---|---|
| `fee_due` | Manager notif + parent SMS + parent email per invoice falling due in 1–4 days | every run; deduped 23h per invoice |
| `medicine_expiry` | One digest per centre listing meds expiring within 30 days | every run; deduped 23h per centre |
| `absence_escalation` | Flag riders with 3+ absences in last 5 sessions; manager notif + parent SMS + parent email | every run; deduped 7 days per rider |
| `birthdays` | 🎂 manager notif + parent SMS + parent email for riders whose DOB matches today | every run; deduped 23h per rider |
| `monthly_reports` | §4.5 — parent email with previous month's report card snapshot | **only fires on day 1** (override `?force=1` for testing); deduped 20 days per rider |

### Setup

1. Generate a secret: `openssl rand -hex 32`
2. Set `CRON_SECRET` in `.env`
3. Wire your scheduler to POST `/api/cron/sweep` with `Authorization: Bearer <CRON_SECRET>` (or `?secret=...` for Vercel Cron)

### Schedulers — examples

**Vercel Cron** (recommended for Vercel deploys) — copy `vercel.json.example` to `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/sweep?secret=YOUR_CRON_SECRET", "schedule": "0 6 * * *" }]
}
```

**GitHub Actions** (works for any host) — `.github/workflows/cron.yml`:
```yaml
on:
  schedule:
    - cron: "0 6 * * *"
jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://YOUR_HOST/api/cron/sweep
```

**Manual / local**:
```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
# Single job:
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sweep?job=birthdays"
```

## SMS (Twilio)

Parent-facing SMS dispatch is wired into 5 trigger points. When `TWILIO_*` env vars aren't set, every call is a **dry-run**: logs the message to the console + audit log so you can verify the content without burning credits.

| Trigger | Recipient | Message |
|---|---|---|
| `invoice.due_soon` (cron) | Parent | "Fee for {rider} due in {n} days." |
| `rider.absence_streak` (cron) | Parent | "{rider} has been absent 3+ recent sessions." |
| `rider.birthday` (cron) | Parent | "Happy Birthday {rider}! 🎂" |
| `exam.passed` (live) | Parent | "Congratulations! {rider} passed Level {n} with {score}/{max}." |
| `payment.received` (live) | Parent | "Thank you. ₹{amt} fee for {rider} received." |

`exam.failed` deliberately doesn't SMS — the coach delivers that result in person.

### Setup

```
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_FROM="+14155551234"   # Twilio-provided sender ID
```

Phone numbers normalise to E.164 +91 automatically — pass `9876543210` or `+919876543210`, both work. Invalid formats are skipped (logged to audit; no Twilio call). Audit captures one entry per SMS: `sms.dry_run`, `sms.sent` (with Twilio SID), `sms.upstream_error`, `sms.network_error`, or `sms.invalid_phone`.

## Email (SendGrid)

Email dispatch is wired into 6 trigger points (the same 5 as SMS, plus the monthly report card per §4.5). Same dry-run behaviour: with `SENDGRID_*` env vars empty, every call is a no-op that logs to console + audit.

| Trigger | Recipient | Content |
|---|---|---|
| `invoice.due_soon` (cron) | Parent | Itemised reminder with amount, kind, due date, invoice ref |
| `rider.absence_streak` (cron) | Parent | Attendance concern + 15-day membership-cancellation context |
| `rider.birthday` (cron) | Parent | Warm birthday greeting from the centre |
| `exam.passed` (live) | Parent | Score + examiner + "certificate ready for collection" |
| `payment.received` (live + webhook) | Parent | Itemised receipt with method, payment ID, invoice ID |
| `report.monthly_email` (cron, day 1) | Parent | Snapshot table: level, attendance%, skills mastered, exams, certs, fees paid |

### Setup

```
SENDGRID_API_KEY="SG.xxxxxxxxxxxxxxxxxxxxxx"
SENDGRID_FROM_EMAIL="notifications@equiwings.in"   # must be a Verified Sender in SendGrid
SENDGRID_FROM_NAME="Equiwings"                     # optional, defaults to "Equiwings"
```

Templates are inline HTML rendered by `renderEmail({ heading, body, ctaText?, ctaUrl?, centreName? })` in [lib/email.ts](lib/email.ts). All transactional emails share the same wrapper (brand strip + card + closer line) so they look consistent across triggers.

Audit captures one entry per email: `email.dry_run`, `email.sent` (with SendGrid message ID), `email.upstream_error`, `email.network_error`, or `email.invalid_address`.

## WhatsApp (Meta Cloud API)

Parent-facing WhatsApp dispatch fires alongside the SMS triggers for the high-signal parent moments. With `WHATSAPP_*` env vars unset, every call is a **dry-run** (logged to console + audit, never throws).

| Trigger | Recipient | Template name | Body params |
|---|---|---|---|
| `invoice.due_soon` (cron) | Parent | `ew_invoice_due_soon` | rider, days, amount |
| `rider.absence_streak` (cron) | Parent | `ew_absence_streak` | rider |
| `rider.birthday` (cron) | Parent | `ew_birthday` | rider, age |
| `exam.passed` (live) | Parent | `ew_exam_passed` | rider, level, score, max |
| `payment.received` (live + webhook) | Parent | `ew_payment_received` | rider, amount, last-8 ref |

Meta only allows **pre-approved template messages** outside the 24-hour customer-service window. Since every trigger here is outbound-only, all use templates — register each `ew_*` name in WhatsApp Business Manager → Message templates with body variables in the same order.

### Setup

```
WHATSAPP_PHONE_NUMBER_ID="123456789012345"
WHATSAPP_ACCESS_TOKEN="EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
WHATSAPP_API_BASE="https://graph.facebook.com/v18.0"   # optional, defaults to v18.0
```

Phone numbers normalise to E.164 +91 via the same helper used by SMS. Audit captures one entry per send: `whatsapp.dry_run`, `whatsapp.sent` (with Meta message ID), `whatsapp.upstream_error`, `whatsapp.network_error`, or `whatsapp.invalid_phone`.

## File storage

Photos, Aadhaar scans, and indemnity PDFs upload through `/api/upload` (multipart, MIME + size enforced). Each upload writes an audit row (`action=upload`, `file` table) with kind, MIME, size, IP, and user-agent.

[lib/storage.ts](lib/storage.ts) picks the backend at request time based on env config:

- **S3** (or any S3-compatible: AWS S3, Cloudflare R2, DO Spaces, MinIO) when `S3_BUCKET` + `S3_ACCESS_KEY` + `S3_SECRET` + `S3_PUBLIC_URL` are all set.
- **Local filesystem** (`public/uploads/<filename>`) as the dev fallback.

Both backends return the same URL shape — `/uploads/<filename>` — so the DB stays portable. In S3 mode, the `/uploads/:path*` rewrite in [next.config.mjs](next.config.mjs) forwards reads to `${S3_PUBLIC_URL}/:path*`; migrating buckets is a single env-var change with no DB rewrite.

### S3 setup

```
S3_BUCKET="my-bucket"
S3_ACCESS_KEY="AKIAxxxxxxxx"
S3_SECRET="xxxxxxxx"
S3_PUBLIC_URL="https://cdn.example.com"     # public URL prefix for reads (required)
S3_REGION="us-east-1"                       # optional, defaults to us-east-1
S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"   # optional, only for non-AWS providers
```

For Aadhaar scans (spec §9 — "AES-256 at rest"), enable SSE-S3 / SSE-KMS on the bucket and serve only via presigned GET URLs scoped to staff.

Per-kind allow-lists (defined in `lib/storage.ts`):

| Kind | MIMEs | Max size |
|---|---|---|
| `rider_photo` | jpg, png, webp | 5 MB |
| `rider_aadhaar` | jpg, png, pdf | 5 MB |
| `rider_indemnity` | pdf, jpg, png | 5 MB |
| `horse_photo` / `asset_photo` | jpg, png, webp | 5 MB |
| `generic` | jpg, png, webp, pdf | 5 MB |

The onboarding API also Zod-validates the returned URL matches `^/uploads/[a-z0-9._-]+$` — clients can't smuggle external URLs into a rider record.

## What's left for production

Spec coverage is complete. Scheduled sweeps, Razorpay, SMS, email, WhatsApp (Meta Cloud API), and file storage (local fallback + S3/R2/Spaces) are all wired. Vitest covers the pure helpers in `lib/`. Next on the test roadmap: Playwright for the onboarding wizard + exam scoring + Razorpay paths, supertest for the API guards.

## Tests

Vitest, mix of unit and integration:

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run test:coverage  # with coverage
```

DB-backed tests run against a dedicated `prisma/test.db` — [tests/global-setup.ts](tests/global-setup.ts) deletes any stale file and runs `prisma db push` once per `vitest run`, then teardown removes it. [tests/helpers/db.ts → resetDb()](tests/helpers/db.ts) clears every model in `beforeEach` with `deleteMany` calls in dependency order. [vitest.config.ts](vitest.config.ts) uses `pool: "forks"` with `fileParallelism: false` so each test file runs in its own fork (fresh PrismaClient + fresh connection) and files run sequentially (no SQLite write contention). Cross-file isolation matters here: without it, Prisma + SQLite produces non-deterministic phantom-FK errors where a row created in one test is invisible to FK checks in the next, even though direct reads return it.

Currently covered:
- `lib/utils.ts` — `cn`, `calcBmi`, `formatDate`, `maskAadhaar`
- `lib/sms.ts` — `normalizeIndianPhone`
- `lib/storage.ts` — `isAllowedMime`, `maxBytesFor`, and `uploadFile` early-return validation (kind / MIME / size / empty)
- `lib/permissions.ts` — `can`, `requirePerm`, `permissionsFor` across the 8-role matrix
- `lib/razorpay.ts` — `isConfigured`, `publicKeyId`, and HMAC verifiers for both checkout signature and webhook signature (positive + tampered + missing-secret paths)
- `lib/cert.ts` — `verifyUrl` (base-URL handling) and `qrSvg` (output shape + sizing)
- `lib/email.ts` — `isValidEmail` and `renderEmail` (HTML shape + CTA branches + centreName fallback)
- `lib/auth.ts` — bcrypt `hashPassword`/`verifyPassword` roundtrip plus JWT `signSession`/`verifySession` (valid, tampered, garbage, wrong-secret)
- `lib/schemas/exam.ts` — `parseRubric` (valid / malformed JSON / schema-mismatch), `computeTotal` (numeric sum, missing scores, non-numeric items, non-numeric categories, "Miscellaneous Questions" exclusion), plus zod validation for `createExamSchema`, `updateExamScoreSchema`, `updateScoringTemplateSchema`
- `lib/tenancy.ts` — `scopeCentre` (SUPER_ADMIN passthrough, own-centre lock, cross-centre rejection, missing-centre throw) and `centreWhere`
- `lib/whatsapp.ts` — `isWhatsAppConfigured`, plus `sendWhatsApp` with `fetch` mocked: invalid-phone short-circuit, dry-run when unconfigured, Meta request shape (URL, Authorization header, body params, phone-without-+ format), custom `language` override, upstream `META_<status>` errors, and `NETWORK` fallback when fetch throws
- `lib/audit.ts` — DB-backed: required-fields write, JSON stringification of `before`/`after`, `ip`/`userAgent` forwarding, optional `userId` FK, falsy-value nulling
- `lib/notify.ts` — DB-backed: defaults (channel = `in_app`, payload JSON), explicit-channel override, FK violation swallowed (`null` return, no throw), `notifyMany` dedup + falsy-id filter + partial-failure resilience, `notifyRole` filters by role/centre/status (excludes suspended + other-centre + wrong-role), `notifyCentreManager` happy path + no-op when no manager + unknown centre
- `lib/sweeps.ts` — DB-backed, all 5 cron jobs: `sweepFeeDue` (window match, out-of-window/paid exclusion, 23h dedup, no-manager skip), `sweepMedicineExpiry` (30-day window, qty=0 excluded, multi-med digest), `sweepAbsenceEscalation` (3+/5 absences flag, 2/5 no flag), `sweepBirthdays` (today match vs miss), `sweepMonthlyReports` (first-of-month gate + `force` override, riders without email skipped)
- `app/api/auth/login/route.ts` — DB-backed: VALIDATION 400s (malformed body, bad email, missing password, non-JSON), 401 for unknown email / wrong password / suspended user, 500 on invalid stored role, happy path sets HttpOnly `ew_session` cookie carrying a verifiable JWT payload (userId / role / centreId / name)

Other API routes and the onboarding wizard have been manually smoke-tested; automated coverage for those is still on the roadmap.
