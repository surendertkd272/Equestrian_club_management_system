# Deploying Equiwings to production

End-to-end runbook for a paid India SaaS launch. Order matters — items
later in the list depend on earlier ones.

> **Verify before going live:** `npm run preflight` — refuses to run if
> any required production env var is missing. Run it locally with
> `NODE_ENV=production` and the real `.env.production` file to confirm.

---

## 1. Pick a Postgres host (one-time)

Equiwings is portable across SQLite (dev) and Postgres (prod). Recommended hosts:

| Provider | INR pricing tier | Pooler | Why |
|---|---|---|---|
| **Neon** | $0–19/mo starter | built-in pgbouncer | Lowest friction, ap-south-1 region available |
| **Supabase** | $0–25/mo | pgbouncer add-on | Solid for India; bundles storage if you want to skip S3 |
| **AWS RDS** | ~₹2k/mo db.t4g.micro | RDS Proxy | Pick if you're already on AWS |

Pooler is non-negotiable. Serverless Postgres + no pool = connection
exhaustion the first time a tenant CSV imports 5k riders.

The pooled connection string goes in `DATABASE_URL`. Example:

```
postgresql://user:pass@ep-foo.ap-south-1.neon.tech:5432/equiwings?pgbouncer=true&connection_limit=1
```

After setting it: run `npx prisma db push` once locally pointed at the
prod DB to create the schema. CI will keep schema migrations applied via
`prisma migrate deploy` once you start using migrations (we currently
use `db push` for the dev SQLite flow).

---

## 2. Razorpay (subscriptions in INR)

1. Sign up at https://razorpay.com — KYC will take 2–3 working days.
2. Once activated, in the dashboard:
   - **Settings → API Keys → Generate live keys** → put into
     `RAZORPAY_KEY_ID` (and `NEXT_PUBLIC_RAZORPAY_KEY_ID` — same value),
     and `RAZORPAY_KEY_SECRET`.
   - **Settings → Webhooks → Add new** at
     `https://YOUR_DOMAIN/api/webhooks/razorpay`. Subscribe to these events
     (others can be added later, none break the flow):
     - `payment.captured` (tenant-side rider invoices — flips
       invoice.status to paid + rider.status to active for registration)
     - `payment.failed` (optional but recommended — surface failed payment
       attempts so the centre knows the parent tried)
     - `subscription.charged` (SaaS billing — fires SaasInvoice)
     - `subscription.halted` / `subscription.pending`
     - `subscription.cancelled` / `subscription.completed`
     - `subscription.authenticated` / `subscription.activated`
   - Generate a secret for the webhook → `RAZORPAY_WEBHOOK_SECRET`.

   **End-to-end registration flow** (once keys + webhook are live):
   1. Parent submits at `/onboarding/<centre-slug>` → rider goes
      `pending_approval`.
   2. Centre admin approves on `/enrolments` → registration invoice
      created, rider goes `pending_payment`, parent gets an email
      + SMS + WhatsApp with a link to `/pay/<invoiceId>`.
   3. Parent clicks the link, lands on the public payment page, hits
      "Pay now" → Razorpay modal opens (UPI / Card / Netbanking).
   4. On capture, `payment.captured` webhook fires → invoice marked
      paid, rider goes `active`, parent gets a receipt by email + SMS.

   For testing without real money: use the dev `/api/payments/razorpay/mock`
   endpoint (only fires when NEXT_PUBLIC_RAZORPAY_KEY_ID is unset).
3. **Subscription plans** — under **Subscriptions → Plans → Create plan**,
   make three plans (monthly billing) at your actual ₹ prices. Copy the
   plan IDs:
   - `RAZORPAY_PLAN_STARTER`
   - `RAZORPAY_PLAN_PRO`
   - `RAZORPAY_PLAN_ENTERPRISE`

The owner portal's "Create Razorpay subscription" button refuses to
fire if any of the three is blank — you'll see `PLAN_ID_NOT_CONFIGURED`.

---

## 3. Stripe (optional — international cards)

Same idea. Webhook URL: `https://YOUR_DOMAIN/api/webhooks/stripe`.
Subscribe to:
- `customer.subscription.created` / `.updated` / `.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded` (this is what fires the SaasInvoice issue)

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. For the "Manage billing"
portal button, also set `STRIPE_BILLING_PORTAL_RETURN_URL` to a tenant
page URL (e.g. `https://app.equiwings.in/owner/tenants`).

---

## 4. SMS — DLT registration (India regulatory)

TRAI bans non-DLT-registered transactional SMS. Twilio works in India only
through their **Indian-licensed sender ID**, which requires DLT registration
with one of: Vilpower (Vodafone Idea), TataPower, JioTrueConnect, Airtel Iris,
or BSNL DLT.

1. Register your business as a **Principal Entity** on one DLT portal
   (typically takes 2–4 business days).
2. Register **headers** (the 6-character SMS sender ID, e.g. `EQUIWN`).
3. Register **templates** (the message body, with `{#var#}` placeholders).
   Equiwings sends these — register each:
   - Fee due reminder (`ew_invoice_due_soon`)
   - Payment received receipt (`ew_payment_received`)
   - Absence streak alert (`ew_absence_streak`)
   - Birthday wishes (`ew_birthday`)
   - Exam result (`ew_exam_result`)
4. Once approved, give Twilio the DLT entity ID + template IDs via their
   support portal; Twilio injects them into the outbound SMS.

> Note: `lib/sms.ts` already calls Twilio's standard API; no code change
> needed once DLT registration is complete. The body in our code must
> match the registered template verbatim — variables only differ.

Set:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` (the DLT-approved sender ID, e.g. `+91...` or alphanumeric)

---

## 5. WhatsApp Business API

Use Meta Cloud API directly or via a BSP (360Dialog, Twilio WA, Gupshup).
Pre-approved templates are required for outbound messages — the system
sends:
- `ew_invoice_due_soon`
- `ew_payment_received`
- `ew_absence_streak`
- `ew_birthday`
- `ew_exam_result`
- `ew_competition_placement`
- `ew_enrolment_approved` — fires when an admin approves a self-enrolled
  rider; body params: `{rider name}`, `{amount with ₹ prefix}`, `{pay URL}`.
  Sample body: *"Hi! {{1}}'s registration has been approved. Pay {{2}}
  to activate the account: {{3}}"*

Set `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`. `lib/whatsapp.ts`
talks directly to Meta Cloud API at `${WHATSAPP_API_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`
(base defaults to `https://graph.facebook.com/v18.0` — override only if
you're going through a BSP that proxies Meta).

---

## 6. Email DNS — SPF + DKIM + DMARC

Without these, Gmail and Yahoo flag emails as spam from the first send.

Add three TXT records to your sending domain:

```
SPF (TXT @)
  v=spf1 include:sendgrid.net ~all

DKIM (TXT s1._domainkey)
  <copy from SendGrid → Sender Authentication → DKIM>

DMARC (TXT _dmarc)
  v=DMARC1; p=quarantine; rua=mailto:dmarc@equiwings.in; pct=100; adkim=s; aspf=s
```

If you're on a different ESP, swap `include:sendgrid.net` accordingly.
After publishing, verify in SendGrid's "Sender Authentication" — green
checks across the board. **Don't deploy before this passes** — bulk
sender rules at Gmail/Yahoo (Feb 2024) reject unauthenticated mail.

Verify externally with [dmarcian.com/dmarc-inspector](https://dmarcian.com/dmarc-inspector/).

---

## 7. Domain + SSL

1. Point the apex (`equiwings.in`) and `app.equiwings.in` to your host
   (Vercel: `cname.vercel-dns.com`).
2. Vercel/Cloudflare issue SSL automatically once DNS resolves.
3. Optional: customer custom domains — tenants point their CNAME at
   `app.equiwings.in`; the owner portal's "Custom Domain" panel marks
   each verified after you confirm SSL provisioning.

---

## 8. Cron schedule

`vercel.json` already declares a daily 02:00 UTC sweep at
`/api/cron/sweep?secret=$CRON_SECRET`. If you're not on Vercel:

- **GitHub Actions:** add `.github/workflows/cron.yml` with a `schedule`
  trigger calling `curl` to the same URL.
- **cron-job.org / EasyCron:** add a job with the same URL + headers.

The sweep runs every job idempotently — over-firing is safe (each job's
internal dedup catches it). Under-firing means missed fee reminders +
trial-end transitions; don't drop below daily.

---

## 9. Sentry

```
npm install @sentry/nextjs
```

Then call `initSentry()` from `app/layout.tsx` (top of file) and the
cron route. Set `SENTRY_DSN` in env. `lib/sentry.ts` is a no-op until
both are in place — safe to deploy without it; just monitor your hosting
provider's logs in the interim.

---

## 10. Pricing + legal copy

1. Open `app/pricing/page.tsx`. Replace `monthlyInrPlaceholder` and
   `annualInrPlaceholder` for each tier with your real ₹ values.
2. Open `app/privacy/page.tsx` + `app/terms/page.tsx`. Search for
   `{{` — every placeholder must be filled before publishing. Get a
   lawyer's eyes on it; the scaffold is DPDPA-aware but not jurisdictionally
   defensible without review.
3. Update the owner portal billing config at `/owner/billing` with your
   legal entity GSTIN, HSN, address. Without GSTIN set there, the printed
   invoice's GST split silently degrades to "no tax shown".

---

## 11. First admin user

After deploying:

```bash
# Generate a strong password
openssl rand -base64 16

# Run the platform-user creation script
npm run owner:create-admin -- --email you@equiwings.in --name "Your Name" --password "<above>"
```

Or use the bundled seed (dev only):

```bash
npm run db:seed
# Default: owner@platform.local / password
```

In production, **never run `db:seed`** — it creates test users with
predictable passwords and seeds sample tenants.

---

## 12. Pre-flight check

```bash
NODE_ENV=production npm run preflight
```

Expected output:

```
✓ DATABASE_URL is set (postgresql://…)
✓ JWT_SECRET is ≥ 32 chars
✓ NEXT_PUBLIC_APP_URL is HTTPS in production
✓ CRON_SECRET is set
✓ SENDGRID_API_KEY + SENDGRID_FROM_EMAIL are set
✓ RAZORPAY_* credentials set
✓ Razorpay plan IDs set for all 3 tiers
✓ STRIPE_* credentials set (optional, present)
✓ Twilio credentials set
✓ WhatsApp credentials set
✓ S3 storage configured
✓ Sentry DSN set
✗ APP_HOSTS missing — falling back to NEXT_PUBLIC_APP_URL host

12 OK · 1 warning · 0 fail
```

Fail-on-any-red. Warnings are advisory; fails block production.

---

## 13. Deploy

Vercel:

```bash
vercel link
vercel env pull .env.production.local
NODE_ENV=production npm run preflight   # last sanity check
vercel deploy --prod
```

Other hosts: same idea — push the verified env, then deploy.

After deploy: open `/api/health` from outside (uptime monitor) and
confirm a 200 with `db.ok=true`.

---

## Optional hardening (post-launch)

### Image processing on upload

`/api/upload` writes raw files. To resize + strip EXIF before the file
lands on disk:

```bash
npm install sharp
```

Then update `lib/storage.ts` to pipe the buffer through `sharp` for
`rider_photo` / `horse_photo` / `asset_photo` kinds. Typical recipe:

```typescript
import sharp from "sharp";

if (opts.kind === "rider_photo" || opts.kind === "horse_photo" || opts.kind === "asset_photo") {
  const processed = await sharp(opts.buffer)
    .rotate()                            // applies EXIF orientation, then strips it
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .withMetadata({ exif: {} })          // strip GPS + camera metadata
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  opts.buffer = processed;
  opts.mime = "image/jpeg";
}
```

This brings 12MB DSLR photos down to ~150KB without visible quality
loss and removes GPS coordinates from rider/horse photos.
Vercel/Linux platforms work out of the box; AWS Lambda needs the Sharp
layer added.

### CDN for /uploads

Drop Cloudflare or BunnyCDN in front of your S3 bucket. Configure the
CDN to fetch from `S3_PUBLIC_URL`, then set `S3_PUBLIC_URL` itself to
the CDN hostname. The `next.config.mjs` rewrite at `/uploads/:path*`
will then serve through the CDN automatically.

### Redis for rate limiter + SSE cap

Both currently live in process memory (`lib/rate-limit.ts`, the SSE
connection counter in `app/api/notifications/stream/route.ts`). For
horizontal scale, replace with Upstash Redis (cheapest serverless
option in ap-south-1) or Vercel KV. The contract in `lib/rate-limit.ts`
is `checkRate(key, limit, windowMs)` → swap the in-memory map for a
Redis `INCR` + `EXPIRE`. Same shape, no caller change.

### Background job queue

CSV imports, bulk PDF generation, mass email currently run inline on
the request that triggers them. Move to a queue when first slow request
shows up:

- Add a `Job` table (id, type, payload JSON, status, runAt, finishedAt)
- One sweep per minute pulls due jobs + dispatches the actual work
- HTTP endpoints insert jobs instead of running them inline

---

## Post-launch checklist

- [ ] Razorpay live mode switched on (yellow "test mode" banner gone)
- [ ] First webhook delivered + logged (`/owner` dashboard shows
      "Recent invoices" populated)
- [ ] First tenant successfully signed up via `/onboarding` end-to-end
- [ ] Status page / uptime monitor configured against `/api/health`
- [ ] Backup schedule confirmed with DB host (Neon: 7d retention free,
      30d on Pro)
- [ ] DMARC report email box (`dmarc@equiwings.in`) being delivered
- [ ] Sentry events arriving on a deliberate test error
