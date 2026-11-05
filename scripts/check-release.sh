#!/usr/bin/env bash
# pnpm check:release: the CI checks check:batch doesn't run, for a release
# branch before its PR: commit rules over the branch, migrations, tax
# parameters and the PostgreSQL job's suites (TEST_DATABASE_URL must point at
# a throwaway PostgreSQL database). E2E, the Docker image and the compose boot
# stay CI's. It runs every step, prints a report and exits non-zero on a
# failure.
set -uo pipefail

failed=()
step() {
  local name="$1"
  shift
  echo "== $name"
  if "$@"; then
    echo "   ok"
  else
    failed+=("$name")
  fi
}

base=$(git merge-base origin/main HEAD 2>/dev/null || echo origin/main)

step "commit rules ($base..HEAD)" pnpm -s tsx scripts/check-commit.ts --strict --range "$base..HEAD"
step "migrations" pnpm -s check:migrations
step "tax parameters (blocking when tax data changed since $base)" pnpm -s check:tax-params --base "$base"
step "tax-data dataVersion raised where tax data changed" pnpm -s tsx scripts/check-tax-data-version.ts "$base"
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  step "migrations from empty (PostgreSQL)" env DATABASE_URL="$TEST_DATABASE_URL" bash -c 'pnpm -s build:migrator && node db-migrate.js'
  step "constraint snapshot" pnpm -s check:constraints
  for t in tests/routers/demo-postgres.test.ts tests/routers/fresh-install-postgres.test.ts \
    tests/routers/seeded-postgres.test.ts tests/baseline/router-baseline-postgres.test.ts; do
    step "PostgreSQL: $t" pnpm -s test "$t"
  done
else
  echo "== PostgreSQL suites"
  echo "   skipped: TEST_DATABASE_URL is not set"
  failed+=("PostgreSQL suites (not run)")
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "check:release: FAILED: ${failed[*]}"
  exit 1
fi
echo "check:release: passed"
