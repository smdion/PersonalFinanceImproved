#!/usr/bin/env bash
# scripts/test-migration.sh
#
# Migration safety test — the release gate for any release with a migration.
#
# Snapshots a source PostgreSQL database via pg_dump, restores it into a
# throwaway database, runs `pnpm db:migrate` against it, and verifies:
#   - the migrator exited 0 and logged no squash_upgrade_failed (and, when
#     the source had more journal rows than the journal has entries, that
#     the squash completed);
#   - __drizzle_migrations holds exactly the journal's file hashes;
#   - every table and column of the latest drizzle snapshot exists;
#   - row counts are unchanged, apart from the reference tables (the
#     tax-data reconcile may add rows) and app_settings.
#
# The source must be v0.8.14 or later (v0.9.0 refuses older databases).
#
# Usage:
#   ./scripts/test-migration.sh <source-database-url> [target-database-url]
#   SOURCE_DATABASE_URL=postgresql://... ./scripts/test-migration.sh
#
# With a target URL (an EMPTY database you created, e.g. on the dev server)
# no Docker is needed; it is left in place for inspection. Without one, a
# throwaway postgres:16 container is started and torn down on exit.
#
# Requirements: pg_dump + psql + node in PATH; docker only without a target.
#
# Exit 0 = migration succeeded against the snapshot.
# Exit 1 = anything went wrong (dump, restore, migrate, verify).

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BOLD}=> $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}! $*${NC}"; }
err()  { echo -e "${RED}✗ $*${NC}" >&2; }

SOURCE_URL="${1:-${SOURCE_DATABASE_URL:-}}"
TARGET_URL="${2:-}"
if [[ -z "$SOURCE_URL" ]]; then
  err "Usage: $0 <source-database-url> [target-database-url]"
  err "    or: SOURCE_DATABASE_URL=postgresql://... $0"
  exit 1
fi

# ── Pre-flight ────────────────────────────────────────────────────────

step "Checking prerequisites"

NEEDED="pg_dump psql node"
[[ -z "$TARGET_URL" ]] && NEEDED="docker $NEEDED"
for cmd in $NEEDED; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed"
    exit 1
  fi
done
ok "$NEEDED all present"

if [[ -z "$TARGET_URL" ]] && ! docker info >/dev/null 2>&1; then
  err "Docker daemon is not running or not reachable"
  exit 1
fi

# ── 1. Snapshot the source ───────────────────────────────────────────

step "Snapshotting source database"

DUMP_FILE="$(mktemp -t ledgr-mig-test-XXXXXX.sql)"
# The migrator's pre-upgrade backup is a full copy of the source's data —
# keep it out of the repo and delete it with the dump.
export LEDGR_BACKUP_DIR="$(mktemp -d -t ledgr-mig-test-backups-XXXXXX)"
trap 'rm -f "$DUMP_FILE"; rm -rf "$LEDGR_BACKUP_DIR"' EXIT

if ! pg_dump --no-owner --no-acl --clean --if-exists "$SOURCE_URL" > "$DUMP_FILE" 2>/tmp/ledgr-pgdump.log; then
  err "pg_dump failed (see /tmp/ledgr-pgdump.log)"
  cat /tmp/ledgr-pgdump.log >&2
  exit 1
fi

DUMP_BYTES=$(wc -c < "$DUMP_FILE")
ok "Dumped to $DUMP_FILE ($DUMP_BYTES bytes)"

# ── 2. Target database ───────────────────────────────────────────────

if [[ -n "$TARGET_URL" ]]; then
  TEMP_URL="$TARGET_URL"
  if ! TARGET_TABLES=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','drizzle')"); then
    err "Can't connect to the target database"
    exit 1
  fi
  if [[ "$TARGET_TABLES" != "0" ]]; then
    err "Target database is not empty"
    exit 1
  fi
  ok "Using the empty target database"
else
  step "Starting throwaway PostgreSQL container"

  CONTAINER_NAME="ledgr-migration-test-$$"
  HOST_PORT=15432
  TEMP_URL="postgresql://postgres:test@localhost:${HOST_PORT}/test"

  cleanup_container() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  }
  trap 'cleanup_container; rm -f "$DUMP_FILE"; rm -rf "$LEDGR_BACKUP_DIR"' EXIT

  docker run -d --rm \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=test \
    -p "${HOST_PORT}:5432" \
    postgres:16-alpine >/dev/null

  ok "Container $CONTAINER_NAME started on localhost:$HOST_PORT"

  step "Waiting for PostgreSQL to be ready"
  ready=false
  for i in $(seq 1 30); do
    if docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if ! $ready; then
    err "PostgreSQL did not become ready within 30 seconds"
    exit 1
  fi
  ok "PostgreSQL ready"
fi

# ── 3. Restore the snapshot ──────────────────────────────────────────

step "Restoring snapshot"

if ! psql "$TEMP_URL" -v ON_ERROR_STOP=1 < "$DUMP_FILE" >/tmp/ledgr-restore.log 2>&1; then
  err "psql restore failed (see /tmp/ledgr-restore.log)"
  tail -40 /tmp/ledgr-restore.log >&2
  exit 1
fi
ok "Snapshot restored"

# Reference tables may gain rows (the tax-data reconcile), never lose them;
# app_settings gains the upgrade-backup flag. Every other table is unchanged.
REFERENCE_TABLES="'contribution_limits', 'tax_brackets', 'ltcg_brackets', 'irmaa_brackets', 'fpl_by_household', 'tax_params'"
counts_sql() { echo "SELECT 'SELECT * FROM (' || string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', table_name, table_name), ' UNION ALL ') || ') c ORDER BY t' FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND $1"; }
row_counts() { psql "$TEMP_URL" -tAc "$(psql "$TEMP_URL" -tAc "$(counts_sql "table_name NOT IN ('app_settings', '__drizzle_migrations', $REFERENCE_TABLES)")")"; }
ref_counts() { psql "$TEMP_URL" -tAc "$(psql "$TEMP_URL" -tAc "$(counts_sql "table_name IN ($REFERENCE_TABLES)")")"; }
COUNTS_BEFORE="$(row_counts)"
REF_BEFORE="$(ref_counts)"
ROWS_BEFORE=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo 0)

# ── 4. Run db:migrate against the restored copy ──────────────────────

step "Running pnpm db:migrate"

cd "$(dirname "$0")/.."
if ! DATABASE_URL="$TEMP_URL" pnpm db:migrate 2>&1 | tee /tmp/ledgr-migrate.log; then
  err "Migration failed (see /tmp/ledgr-migrate.log)"
  exit 1
fi
if grep -q '"squash_upgrade_failed"\|"migration_failed"' /tmp/ledgr-migrate.log; then
  err "The migrator logged a failure (see /tmp/ledgr-migrate.log)"
  exit 1
fi
JOURNAL_ENTRIES=$(node -e 'console.log(require("./drizzle/meta/_journal.json").entries.length)')
if (( ROWS_BEFORE > JOURNAL_ENTRIES )) && ! grep -q '"squash_upgrade_complete"' /tmp/ledgr-migrate.log; then
  err "Source had $ROWS_BEFORE journal rows (> $JOURNAL_ENTRIES entries) but no squash completed"
  exit 1
fi
ok "Migration completed"

# ── 5. Journal = the files ───────────────────────────────────────────

step "Verifying the migration journal"

EXPECTED_HASHES=$(node -e '
  const fs = require("fs"), c = require("crypto");
  for (const e of require("./drizzle/meta/_journal.json").entries)
    console.log(c.createHash("sha256").update(fs.readFileSync(`drizzle/${e.tag}.sql`, "utf8")).digest("hex"));
' | sort)
RECORDED_HASHES=$(psql "$TEMP_URL" -tAc "SELECT hash FROM drizzle.__drizzle_migrations" | sort)
if [[ "$EXPECTED_HASHES" != "$RECORDED_HASHES" ]]; then
  err "__drizzle_migrations doesn't hold exactly the journal's file hashes"
  diff <(echo "$EXPECTED_HASHES") <(echo "$RECORDED_HASHES") >&2 || true
  exit 1
fi
ok "Journal holds exactly the $JOURNAL_ENTRIES file hashes"

# ── 6. Schema = the latest snapshot ──────────────────────────────────

step "Verifying every table and column of the latest snapshot"

EXPECTED_COLS=$(node -e '
  const j = require("./drizzle/meta/_journal.json");
  const idx = String(j.entries[j.entries.length - 1].idx).padStart(4, "0");
  const s = require(`./drizzle/meta/${idx}_snapshot.json`);
  for (const t of Object.values(s.tables))
    for (const c of Object.values(t.columns)) console.log(`${t.name}.${c.name}`);
' | sort)
ACTUAL_COLS=$(psql "$TEMP_URL" -tAc "SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'" | sort)
MISSING=$(comm -23 <(echo "$EXPECTED_COLS") <(echo "$ACTUAL_COLS"))
if [[ -n "$MISSING" ]]; then
  err "Missing after migration:"
  echo "$MISSING" >&2
  exit 1
fi
ok "$(echo "$EXPECTED_COLS" | wc -l) columns present"

# ── 7. Data kept ─────────────────────────────────────────────────────

step "Verifying row counts"

COUNTS_AFTER="$(row_counts)"
CHANGED=$(diff <(echo "$COUNTS_BEFORE") <(echo "$COUNTS_AFTER") | grep '^<' || true)
if [[ -n "$CHANGED" ]]; then
  err "Row counts changed (before → see /tmp/ledgr-migrate.log):"
  echo "$CHANGED" >&2
  exit 1
fi
ok "Row counts unchanged (apart from the reference tables and app_settings)"

LOST=$(join -t'|' <(echo "$REF_BEFORE") <(ref_counts) | awk -F'|' '$3 < $2 { print $1 ": " $2 " → " $3 }')
if [[ -n "$LOST" ]]; then
  err "Reference tables lost rows:"
  echo "$LOST" >&2
  exit 1
fi
ok "Reference tables kept every row"

echo ""
echo -e "${GREEN}${BOLD}MIGRATION TEST PASSED${NC}"
