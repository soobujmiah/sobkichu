#!/usr/bin/env bash
# Runs once after the devcontainer is created.
# Master prompt Section 4: setup instructions point HERE, not at
# "install X on your machine".
set -euo pipefail

echo "==> Sobkichu devcontainer setup"

DB_URL="${DATABASE_URL:-postgresql://sobkichu:sobkichu@db:5432/sobkichu}"

# --- wait for Postgres -------------------------------------------------------
echo "==> Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if pg_isready -d "$DB_URL" >/dev/null 2>&1; then
    echo "    PostgreSQL ready."
    break
  fi
  sleep 2
  [ "$i" -eq 30 ] && { echo "    PostgreSQL did not become ready in time." >&2; exit 1; }
done

# --- apply the Phase 1 canonical schema --------------------------------------
# Idempotent: skipped if the schema is already present, so rebuilding the
# container on an existing volume doesn't error.
if psql "$DB_URL" -tAc "SELECT to_regclass('public.app_order')" | grep -q app_order; then
  echo "==> Schema already present, skipping."
else
  echo "==> Applying docs/data-model/phase-1-schema.sql"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f docs/data-model/phase-1-schema.sql
  echo "    Schema applied."
fi

# Migrations are forward-only and individually idempotent.
for migration in docs/data-model/migrations/*.sql; do
  [ -e "$migration" ] || continue
  echo "==> Applying $migration"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration" || true
done

# --- seed Dhaka sample data --------------------------------------------------
if [ -f .devcontainer/seed.sql ]; then
  echo "==> Seeding Dhaka sample data"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f .devcontainer/seed.sql
  echo "    Seed applied."
fi

# --- dependencies, if the codebases exist yet --------------------------------
if [ -f api/package.json ]; then
  echo "==> Installing API dependencies"
  (cd api && npm ci --no-audit --no-fund)
fi

if [ -f mobile/pubspec.yaml ]; then
  echo "==> Fetching Flutter packages"
  (cd mobile && flutter pub get)
fi

# --- local env template ------------------------------------------------------
if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example (values are empty; real secrets live in GitHub Actions secrets)"
fi

cat <<'EOF'

==> Ready.

  Database : $DATABASE_URL   (PostGIS enabled, Phase 1 schema applied, seeded)
  Cache    : $REDIS_URL
  Flutter  : flutter --version
  Node     : node --version

  Docs     : docs/README.md
  Start at : docs/architecture/overview.md

  Reminder: this environment is for build/test/debug. Performance sign-off
  still requires a low-end (2-4GB RAM) profile — see docs/workflow/testing-strategy.md

EOF
