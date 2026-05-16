#!/usr/bin/env bash
# Supabase bootstrap — one-shot setup against a fresh Postgres project.
#
# Run from the repo root after filling DATABASE_URL + DIRECT_URL in .env:
#   bash scripts/supabase-bootstrap.sh
#
# What it does:
#   1. Regenerates the Prisma client against the new postgresql datasource.
#   2. Pushes the schema (creates every table + index in Supabase).
#   3. Runs the smoke-test SQL to prove read + write work end-to-end.
#
# Idempotent — re-running on an already-bootstrapped DB is safe; prisma
# db push leaves matching tables alone, and the smoke SQL deletes its
# own probe rows at the end.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Loading .env"
if [ ! -f .env ]; then
  echo "Missing .env — fill DATABASE_URL + DIRECT_URL first."
  exit 2
fi
set -a; source .env; set +a

if [ -z "${DATABASE_URL:-}" ] || [ -z "${DIRECT_URL:-}" ]; then
  echo "DATABASE_URL or DIRECT_URL missing from .env. Aborting."
  exit 2
fi
if [[ "${DATABASE_URL}" == *YOUR_DB_PASSWORD* ]] || [[ "${DIRECT_URL}" == *YOUR_DB_PASSWORD* ]]; then
  echo "Replace YOUR_DB_PASSWORD in .env first."
  exit 2
fi

echo "==> Regenerating Prisma client (postgresql)"
npx prisma generate >/dev/null

echo "==> Pushing schema to Supabase"
npx prisma db push --skip-generate

echo "==> Running smoke-test SQL"
if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found — install it (brew install libpq && brew link --force libpq) or run the SQL manually from the Supabase SQL editor:"
  echo "  ${ROOT}/scripts/supabase-smoke.sql"
  exit 0
fi
psql "${DIRECT_URL}" -v ON_ERROR_STOP=1 -f "${ROOT}/scripts/supabase-smoke.sql"

echo ""
echo "==> Done."
echo "    Schema pushed, smoke test passed. The app can now run against Supabase:"
echo "    npm run dev"
