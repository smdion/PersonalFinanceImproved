#!/usr/bin/env bash
# scripts/test-migration.sh
#
# Migration safety test — the release gate for any release with a migration.
#
# Copies a source database (PostgreSQL: pg_dump into a throwaway database;
# SQLite: VACUUM INTO a temporary file), runs the migrator as the image does
# (the esbuild bundle: `pnpm build:migrator`, then `node db-migrate.js`)
# against the copy, and verifies:
#   - the migrator exited 0 and logged no squash_upgrade_failed (and, when
#     the source had more journal rows than the journal has entries, that
#     the squash completed);
#   - __drizzle_migrations holds exactly the journal's file hashes;
#   - every table and column of the latest drizzle snapshot exists;
#   - row counts are unchanged, apart from app_settings, the reference
#     tables (the tax-data reconcile may add rows) and the tables a pending
#     migration's converters declare they grow or shrink
#     (DataConverter.rowCounts, read by scripts/migration-row-counts.ts).
#
# The source must be v0.8.14 or later (v0.9.0 refuses older databases).
#
# Usage:
#   ENCRYPTION_KEY=... ./scripts/test-migration.sh <source> [target-database-url]
#   SOURCE_DATABASE_URL=postgresql://... ENCRYPTION_KEY=... ./scripts/test-migration.sh
#
# <source> is a postgresql:// URL or a SQLite database file. ENCRYPTION_KEY
# is the source install's key: the migrator encrypts stored credentials
# with it.
#
# PostgreSQL: with a target URL (an EMPTY database you created, e.g. on the
# dev server) no Docker is needed; it is left in place for inspection.
# Without one, a throwaway postgres:16 container is started and torn down on
# exit. SQLite needs neither; the copy is deleted on exit.
#
# Requirements: node + pnpm in PATH, dependencies installed (esbuild, tsx,
# better-sqlite3); for PostgreSQL also pg_dump + psql, and docker without a
# target.
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
  err "Usage: $0 <source-database-url | sqlite-file> [target-database-url]"
  err "    or: SOURCE_DATABASE_URL=postgresql://... $0"
  exit 1
fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
case "$SOURCE_URL" in
  postgres://*|postgresql://*) DIALECT=postgresql; FOLDER=drizzle ;;
  *)
    DIALECT=sqlite; FOLDER=drizzle-sqlite
    if [[ ! -f "$SOURCE_URL" ]]; then
      err "$SOURCE_URL is neither a postgresql:// URL nor a SQLite file"
      exit 1
    fi
    SOURCE_URL="$(cd "$(dirname "$SOURCE_URL")" && pwd)/$(basename "$SOURCE_URL")"
    if [[ -n "$TARGET_URL" ]]; then
      err "A target URL is for PostgreSQL only"
      exit 1
    fi ;;
esac

# ── Pre-flight ────────────────────────────────────────────────────────

step "Checking prerequisites"

if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
  err "ENCRYPTION_KEY is not set: the migrator encrypts stored credentials with it."
  err "Set the source install's key."
  exit 1
fi
NEEDED="node pnpm"
[[ "$DIALECT" == postgresql ]] && NEEDED="$NEEDED pg_dump psql"
[[ "$DIALECT" == postgresql && -z "$TARGET_URL" ]] && NEEDED="docker $NEEDED"
for cmd in $NEEDED; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed"
    exit 1
  fi
done
ok "$NEEDED all present; ENCRYPTION_KEY set"

if [[ "$DIALECT" == postgresql && -z "$TARGET_URL" ]] && ! docker info >/dev/null 2>&1; then
  err "Docker daemon is not running or not reachable"
  exit 1
fi

WORK_DIR="$(mktemp -d -t ledgr-mig-test-XXXXXX)"
DUMP_FILE="$WORK_DIR/dump.sql"
SQLITE_COPY="$WORK_DIR/ledgr.db"
# The migrator's pre-upgrade backup is a full copy of the source's data —
# keep it out of the repo and delete it with the copy.
export LEDGR_BACKUP_DIR="$WORK_DIR/backups"
trap 'rm -rf "${WORK_DIR:?}"' EXIT

# One query against the copy, one `a|b` line per row (psql -tA's form).
sqlite_query() {
  node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { fileMustExist: true });
    for (const row of db.prepare(process.argv[2]).raw().all())
      console.log(row.join("|"));
    db.close();
  ' "$SQLITE_COPY" "$1"
}
query() {
  if [[ "$DIALECT" == postgresql ]]; then psql "$TEMP_URL" -tAc "$1"
  else (cd "$REPO" && sqlite_query "$1"); fi
}

if [[ "$DIALECT" == postgresql ]]; then

# ── 1. Snapshot the source ───────────────────────────────────────────

step "Snapshotting source database"

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
  trap 'cleanup_container; rm -rf "${WORK_DIR:?}"' EXIT

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

else

# ── 1–3. Copy the SQLite source ──────────────────────────────────────

step "Copying the SQLite source"

if ! (cd "$REPO" && node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
  db.prepare("VACUUM INTO ?").run(process.argv[2]);
  db.close();
' "$SOURCE_URL" "$SQLITE_COPY"); then
  err "Copying $SOURCE_URL failed"
  exit 1
fi
ok "Copied to $SQLITE_COPY ($(wc -c < "$SQLITE_COPY") bytes)"

fi

# Reference tables may gain rows (the tax-data reconcile), never lose them;
# app_settings gains the upgrade-backup flag; a pending migration's
# converters may grow or shrink the tables they declare. Every other table
# is unchanged.
REFERENCE_TABLES="contribution_limits tax_brackets ltcg_brackets irmaa_brackets fpl_by_household tax_params"
if [[ "$DIALECT" == postgresql ]]; then
  TABLES_SQL="SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'app_settings'"
  MIGRATIONS_TABLE="drizzle.__drizzle_migrations"
else
  TABLES_SQL="SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT IN ('app_settings', '__drizzle_migrations')"
  MIGRATIONS_TABLE="__drizzle_migrations"
fi
row_counts() {
  local t
  for t in $(query "$TABLES_SQL" | sort); do
    echo "$t|$(query "SELECT count(*) FROM \"$t\"")"
  done
}
COUNTS_BEFORE="$(row_counts)"
RECORDED_BEFORE="$(query "SELECT hash FROM $MIGRATIONS_TABLE" 2>/dev/null || true)"
ROWS_BEFORE=$(echo -n "$RECORDED_BEFORE" | grep -c . || true)
if ! ALLOWED="$(cd "$REPO" && echo "$RECORDED_BEFORE" | node_modules/.bin/tsx scripts/migration-row-counts.ts "$FOLDER")"; then
  err "Reading the converters' row-count allowances failed"
  exit 1
fi

# ── 4. Run the bundled migrator against the copy ─────────────────────

step "Building and running the migrator bundle (db-migrate.js)"

cd "$REPO"
if ! pnpm build:migrator; then
  err "pnpm build:migrator failed"
  exit 1
fi
# DATABASE_URL is always set, so a .env in the checkout can't point the
# migrator at another database.
migrate() {
  if [[ "$DIALECT" == postgresql ]]; then
    DATABASE_URL="$TEMP_URL" node db-migrate.js
  else
    DATABASE_URL="file:$SQLITE_COPY" SQLITE_PATH="$SQLITE_COPY" node db-migrate.js
  fi
}
if ! migrate 2>&1 | tee /tmp/ledgr-migrate.log; then
  err "Migration failed (see /tmp/ledgr-migrate.log)"
  exit 1
fi
if ! grep -q '"migrations_applied"' /tmp/ledgr-migrate.log; then
  err "The migrator didn't report finishing (see /tmp/ledgr-migrate.log)"
  exit 1
fi
if grep -q '"squash_upgrade_failed"\|"migration_failed"' /tmp/ledgr-migrate.log; then
  err "The migrator logged a failure (see /tmp/ledgr-migrate.log)"
  exit 1
fi
JOURNAL_ENTRIES=$(node -e 'console.log(require(`./${process.argv[1]}/meta/_journal.json`).entries.length)' "$FOLDER")
if (( ROWS_BEFORE > JOURNAL_ENTRIES )) && ! grep -q '"squash_upgrade_complete"\|"sqlite_squash_upgrade_complete"' /tmp/ledgr-migrate.log; then
  err "Source had $ROWS_BEFORE journal rows (> $JOURNAL_ENTRIES entries) but no squash completed"
  exit 1
fi
ok "Migration completed"

# ── 5. Journal = the files ───────────────────────────────────────────

step "Verifying the migration journal"

EXPECTED_HASHES=$(node -e '
  const fs = require("fs"), c = require("crypto"), dir = process.argv[1];
  for (const e of require(`./${dir}/meta/_journal.json`).entries)
    console.log(c.createHash("sha256").update(fs.readFileSync(`${dir}/${e.tag}.sql`, "utf8")).digest("hex"));
' "$FOLDER" | sort)
RECORDED_HASHES=$(query "SELECT hash FROM $MIGRATIONS_TABLE" | sort)
if [[ "$EXPECTED_HASHES" != "$RECORDED_HASHES" ]]; then
  err "__drizzle_migrations doesn't hold exactly the journal's file hashes"
  diff <(echo "$EXPECTED_HASHES") <(echo "$RECORDED_HASHES") >&2 || true
  exit 1
fi
ok "Journal holds exactly the $JOURNAL_ENTRIES file hashes"

# ── 6. Schema = the latest snapshot ──────────────────────────────────

step "Verifying every table and column of the latest snapshot"

EXPECTED_COLS=$(node -e '
  const dir = process.argv[1];
  const j = require(`./${dir}/meta/_journal.json`);
  const idx = String(j.entries[j.entries.length - 1].idx).padStart(4, "0");
  const s = require(`./${dir}/meta/${idx}_snapshot.json`);
  for (const t of Object.values(s.tables))
    for (const c of Object.values(t.columns)) console.log(`${t.name}.${c.name}`);
' "$FOLDER" | sort)
if [[ "$DIALECT" == postgresql ]]; then
  ACTUAL_COLS=$(query "SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'" | sort)
else
  ACTUAL_COLS=$(query "SELECT m.name || '.' || p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'" | sort)
fi
MISSING=$(comm -23 <(echo "$EXPECTED_COLS") <(echo "$ACTUAL_COLS"))
if [[ -n "$MISSING" ]]; then
  err "Missing after migration:"
  echo "$MISSING" >&2
  exit 1
fi
ok "$(echo "$EXPECTED_COLS" | wc -l) columns present"

# ── 7. Data kept ─────────────────────────────────────────────────────

step "Verifying row counts"

[[ -n "$ALLOWED" ]] && warn "Allowed by the pending converters: $(echo "$ALLOWED" | tr '\n' ' ')"
CHANGED=$(awk -F'|' -v refs=" $REFERENCE_TABLES " '
  FILENAME == ARGV[1] { allow[$1 "|" $2] = 1; next }
  FILENAME == ARGV[2] { before[$1] = $2; next }
  { after[$1] = $2 }
  END {
    for (t in before) {
      if (!(t in after)) { print t ": " before[t] " → table gone"; continue }
      b = before[t] + 0; a = after[t] + 0
      if (a == b) continue
      if (a > b && (allow[t "|grows"] || index(refs, " " t " "))) continue
      if (a < b && allow[t "|shrinks"]) continue
      print t ": " b " → " a
    }
  }' <(echo "$ALLOWED") <(echo "$COUNTS_BEFORE") <(row_counts))
if [[ -n "$CHANGED" ]]; then
  err "Row counts changed where nothing allows it (see /tmp/ledgr-migrate.log):"
  echo "$CHANGED" >&2
  exit 1
fi
ok "Row counts unchanged, apart from app_settings, reference tables gaining rows and the allowed changes"

echo ""
echo -e "${GREEN}${BOLD}MIGRATION TEST PASSED${NC}"
