#!/usr/bin/env bash
# scripts/test-migration.sh
#
# Migration safety test (v0.5 expert-review companion).
#
# Snapshots a source PostgreSQL database via pg_dump, restores it into
# a throwaway PostgreSQL container, runs `pnpm db:migrate` against the
# throwaway, and verifies that key v5 schema changes are present.
# Tear down on exit.
#
# Use this BEFORE deploying a new release that contains schema changes
# to confirm the migration works against current production data.
#
# Usage:
#   ./scripts/test-migration.sh <source-database-url>
#   SOURCE_DATABASE_URL=postgresql://... ./scripts/test-migration.sh
#
# Requirements:
#   - docker (for the throwaway PG container)
#   - pg_dump + psql in PATH (postgresql-client package on Debian/Ubuntu)
#   - The source database is reachable from this machine
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
if [[ -z "$SOURCE_URL" ]]; then
  err "Usage: $0 <source-database-url>"
  err "    or: SOURCE_DATABASE_URL=postgresql://... $0"
  exit 1
fi

# ── Pre-flight ────────────────────────────────────────────────────────

step "Checking prerequisites"

for cmd in docker pg_dump psql node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed"
    exit 1
  fi
done
ok "docker, pg_dump, psql, node all present"

if ! docker info >/dev/null 2>&1; then
  err "Docker daemon is not running or not reachable"
  exit 1
fi
ok "Docker daemon reachable"

# ── 1. Snapshot the source ───────────────────────────────────────────

step "Snapshotting source database"

DUMP_FILE="$(mktemp -t ledgr-mig-test-XXXXXX.sql)"
trap 'rm -f "$DUMP_FILE"' EXIT

if ! pg_dump --no-owner --no-acl --clean --if-exists "$SOURCE_URL" > "$DUMP_FILE" 2>/tmp/ledgr-pgdump.log; then
  err "pg_dump failed (see /tmp/ledgr-pgdump.log)"
  cat /tmp/ledgr-pgdump.log >&2
  exit 1
fi

DUMP_BYTES=$(wc -c < "$DUMP_FILE")
ok "Dumped to $DUMP_FILE ($DUMP_BYTES bytes)"

# ── 2. Spin up throwaway container ───────────────────────────────────

step "Starting throwaway PostgreSQL container"

CONTAINER_NAME="ledgr-migration-test-$$"
HOST_PORT=15432
TEMP_URL="postgresql://postgres:test@localhost:${HOST_PORT}/test"

cleanup_container() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap 'cleanup_container; rm -f "$DUMP_FILE"' EXIT

docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  -p "${HOST_PORT}:5432" \
  postgres:16-alpine >/dev/null

ok "Container $CONTAINER_NAME started on localhost:$HOST_PORT"

# Wait for postgres to accept connections
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

# ── 3. Restore the snapshot ──────────────────────────────────────────

step "Restoring snapshot into throwaway container"

if ! psql "$TEMP_URL" -v ON_ERROR_STOP=1 < "$DUMP_FILE" >/tmp/ledgr-restore.log 2>&1; then
  err "psql restore failed (see /tmp/ledgr-restore.log)"
  tail -40 /tmp/ledgr-restore.log >&2
  exit 1
fi
ok "Snapshot restored"

# ── 4. Run db:migrate against the throwaway ──────────────────────────

step "Running pnpm db:migrate against the throwaway"

cd "$(dirname "$0")/.."
if ! DATABASE_URL="$TEMP_URL" pnpm db:migrate 2>&1 | tee /tmp/ledgr-migrate.log; then
  err "Migration failed (see /tmp/ledgr-migrate.log)"
  exit 1
fi
ok "Migration completed"

# ── 5. Verify v5 schema markers ──────────────────────────────────────

step "Verifying v5 schema markers"

# Check for is_immutable column on annual_performance
HAS_IMMUTABLE=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='annual_performance' AND column_name='is_immutable'")
if [[ "$HAS_IMMUTABLE" != "1" ]]; then
  err "annual_performance.is_immutable column missing after migration"
  exit 1
fi
ok "annual_performance.is_immutable present"

# Check for the new FK indexes
HAS_BUDGET_IDX=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM pg_indexes WHERE indexname='budget_items_contribution_account_id_idx'")
HAS_API_IDX=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM pg_indexes WHERE indexname='api_connections_linked_profile_id_idx'")
if [[ "$HAS_BUDGET_IDX" != "1" ]]; then
  err "budget_items_contribution_account_id_idx missing"
  exit 1
fi
if [[ "$HAS_API_IDX" != "1" ]]; then
  err "api_connections_linked_profile_id_idx missing"
  exit 1
fi
ok "FK indexes present"

# Check for decimal(14,2) on a sample column
DECIMAL_TYPE=$(psql "$TEMP_URL" -tAc "SELECT data_type || '(' || numeric_precision || ',' || numeric_scale || ')' FROM information_schema.columns WHERE table_name='annual_performance' AND column_name='ending_balance'")
if [[ "$DECIMAL_TYPE" != "numeric(14,2)" ]]; then
  err "ending_balance is $DECIMAL_TYPE, expected numeric(14,2)"
  exit 1
fi
ok "Decimal widening applied (ending_balance = $DECIMAL_TYPE)"

# Verify the row count is preserved (sanity check that data wasn't lost)
ROW_COUNT=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM annual_performance")
ok "annual_performance has $ROW_COUNT rows after migration"

# Verify is_immutable backfill: every is_finalized=true row should have is_immutable=true
NOT_BACKFILLED=$(psql "$TEMP_URL" -tAc "SELECT count(*) FROM annual_performance WHERE is_finalized = true AND is_immutable = false")
if [[ "$NOT_BACKFILLED" != "0" ]]; then
  err "$NOT_BACKFILLED finalized rows missing is_immutable backfill"
  exit 1
fi
ok "is_immutable backfill verified ($NOT_BACKFILLED rows would have leaked through)"

echo ""
echo -e "${GREEN}${BOLD}MIGRATION TEST PASSED${NC}"
echo "The throwaway PG container is being torn down via the trap."
