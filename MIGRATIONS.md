# Database migrations

This project uses **Prisma Migrate**. The Vercel build runs `prisma migrate deploy`
(see `vercel.json` → `buildCommand`), so the database schema is applied on every
deploy and can never drift behind the code again.

Previously the repo used `prisma db push` with no migration history — which is why
shipping a new column (`Vendor.upiId`) 500'd production until the column was added
by hand. This replaces that.

## Prerequisites (Vercel env)
`prisma migrate deploy` connects via **`DIRECT_URL`** (the Supabase direct
port-`5432` string, *not* the `6543` pooler). It **must** be set in the Vercel
project's Environment Variables (Production), alongside `DATABASE_URL`, or the
build fails.

## ⚠️ One-time baseline — DO THIS BEFORE the first deploy of this change
The database already has all 117 tables (it predates migrations). We must tell
Prisma the baseline migration `0_init` is *already applied*, so `migrate deploy`
doesn't try to re-create existing tables. Run these locally with **prod**
`DATABASE_URL` + `DIRECT_URL` exported:

```bash
# 1. Make sure prod actually matches the current schema first (additive only).
#    If this asks for --accept-data-loss, STOP and investigate — do not force it.
npx prisma db push

# 2. Baseline: record 0_init as applied WITHOUT running its SQL.
npx prisma migrate resolve --applied 0_init

# 3. Verify: should report "No pending migrations".
npx prisma migrate status
```

Only **after** step 2 succeeds is it safe to merge this PR / let it deploy. If the
build runs `migrate deploy` before the baseline, it will try to apply `0_init` on
existing tables and the deploy will fail (no data loss — just a failed build).

## Going forward — adding a schema change
Stop using `db push`. Instead:

```bash
# Edit prisma/schema.prisma, then create a migration locally
npx prisma migrate dev --name add_whatever

# commit the generated prisma/migrations/<timestamp>_add_whatever/ folder
```

On merge to `main`, Vercel's build runs `prisma migrate deploy`, applies the new
migration, then builds — so code and DB ship atomically. No more manual `ALTER`s.
