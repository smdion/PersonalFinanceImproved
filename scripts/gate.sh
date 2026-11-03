#!/usr/bin/env bash
# pnpm gate: the mechanical checks over the staged change, run before the
# fresh review (CLAUDE.md § The working loop). Lint and format on the staged
# files, the type-check, tests/lint, and the tests related to the staged
# files. It prints a report and exits non-zero on a failure; no hook runs it,
# and nothing here blocks a commit.
set -uo pipefail

mapfile -t staged < <(git diff --cached --name-only --diff-filter=ACMR)
if [[ ${#staged[@]} -eq 0 ]]; then
  echo "gate: nothing staged"
  exit 0
fi

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

mapfile -t lintable < <(printf '%s\n' "${staged[@]}" | grep -E '\.(ts|tsx|js|mjs|cjs)$')
mapfile -t testable < <(printf '%s\n' "${staged[@]}" | grep -E '^(src|tests|scripts)/.*\.(ts|tsx)$')

echo "== staged change"
git diff --cached --shortstat
src_lines=$(git diff --cached --numstat -- src/ ':(exclude)src/lib/db/sqlite/' ':(exclude)src/lib/db/schema-sqlite.ts' |
  awk '$1 != "-" { n += $1 + $2 } END { print n + 0 }')
echo "   src/ lines changed (generated SQLite excluded): $src_lines (limit 400 unless Mechanical:)"

if [[ ${#lintable[@]} -gt 0 ]]; then
  step "eslint (staged files)" npx eslint --max-warnings 0 "${lintable[@]}"
fi
step "prettier (staged files)" npx prettier --check --ignore-unknown "${staged[@]}"
step "type-check" npx tsc --noEmit -p tsconfig.json
step "type-check tests" pnpm -s check:types-tests
step "tests/lint" npx vitest run tests/lint
if [[ ${#testable[@]} -gt 0 ]]; then
  step "tests related to the staged files" npx vitest related --run --project='!benchmarks' --passWithNoTests "${testable[@]}"
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "gate: FAILED: ${failed[*]}"
  exit 1
fi
echo "gate: passed"
