#!/usr/bin/env bash
# pnpm check:batch: every check CI's `ci` job runs on a code change, over the
# whole tree, for the end of a landing batch (the gate covers one staged
# change; check:release covers the rest of CI before a release). It runs every
# step, prints a report and exits non-zero if any step failed.
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

step "type-check" npx tsc --noEmit
step "type-check tests" pnpm -s check:types-tests
step "type-check scripts" pnpm -s check:types-scripts
step "lint" pnpm -s lint
step "lint:typed" pnpm -s lint:typed
step "dead code" pnpm -s check:dead-code
step "dead code, production" pnpm -s check:dead-code:production
step "layer rules (base $base)" pnpm -s check:layers --base "$base"
step "ratchets and behavior baseline (base $base)" pnpm -s check:ratchets --base "$base"
step "size baseline" pnpm -s check:file-size
step "build" pnpm -s build
step "no prerendered sign-in or dashboard page" pnpm -s tsx scripts/check-prerender.ts
step "tests with coverage thresholds" pnpm -s test:coverage
step "benchmark tests" pnpm -s test:benchmarks
step "bundle size" bash -c 'pnpm -s check:bundle --report && pnpm -s check:bundle'
step "docs freshness" pnpm -s docs:verify
step "engine hash current" pnpm -s check:engine-hash
step "calculation register" pnpm -s check:calculation-register

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "check:batch: FAILED: ${failed[*]}"
  exit 1
fi
echo "check:batch: passed"
