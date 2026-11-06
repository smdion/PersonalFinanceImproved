#!/usr/bin/env bash
# CI's `changes` job: what this run must test, written to $GITHUB_OUTPUT.
#   code=false  a push changed only docs (DOCS_PATHS, but not
#               docs/CALCULATIONS.md, which unit tests read): the heavy
#               steps skip and the docs checks still run. Pull requests
#               test everything.
#   image=true  the Docker build and compose boot run: always on a pull
#               request and on a push to a v* branch; on a push to main
#               only when the image's inputs (IMAGE_PATHS) changed. Never
#               for a docs-only push.
# The base is the newest ancestor of HEAD with a successful push run of
# ci.yml, never the push's "before" commit: a run cancelled by a newer push
# never went green, so its changes are compared again. With no such
# ancestor everything runs.
#
# Needs git with full history, gh with GH_TOKEN (actions: read), and the
# Actions variables GITHUB_EVENT_NAME, GITHUB_REF and GITHUB_REPOSITORY.
set -euo pipefail

IMAGE_PATHS='^(Dockerfile|\.dockerignore|docker-compose[^/]*\.yml|docker-entrypoint\.sh|package\.json|pnpm-lock\.yaml|\.nvmrc|next\.config\.mjs|db-migrate\.ts|drizzle/|drizzle-sqlite/|reference-data/|tax-data/|scripts/ci-image-boot\.sh|src/instrumentation[^/]*\.ts|src/lib/env\.ts|src/lib/db/|playwright\.config\.ts|tests/e2e/(first-run\.spec|boot-admin|auth-flow\.spec|sync-integration-flow\.spec)\.ts)'
DOCS_PATHS='^docs/|\.md$'

out() {
  echo "$1"
  echo "$1" >>"${GITHUB_OUTPUT:-/dev/null}"
}

# The newest ancestor of HEAD that has a green push run, or nothing.
green_base() {
  local shas sha
  shas=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?event=push&status=success&per_page=100" \
    --jq '.workflow_runs[].head_sha') || return 0
  for sha in $(git rev-list --max-count=200 HEAD^ 2>/dev/null); do
    if grep -qx "$sha" <<<"$shas"; then
      echo "$sha"
      return 0
    fi
  done
}

if [ "$GITHUB_EVENT_NAME" != push ]; then
  echo "A $GITHUB_EVENT_NAME run tests everything."
  out code=true
  out image=true
  exit 0
fi

base=$(green_base)
if [ -z "$base" ]; then
  echo "No ancestor of HEAD has a green push run: everything runs."
  out code=true
  out image=true
  exit 0
fi

changed=$(git diff --name-only "$base" HEAD)
echo "Changed since ${base:0:8} (the newest green ancestor):"
echo "${changed:-(nothing)}" | sed 's/^/  /'

if ! grep -qvE "$DOCS_PATHS" <<<"$changed" && ! grep -qx docs/CALCULATIONS.md <<<"$changed"; then
  echo "Docs only: the heavy steps skip."
  out code=false
  out image=false
  exit 0
fi
out code=true
case "$GITHUB_REF" in
  refs/heads/main)
    if grep -qE "$IMAGE_PATHS" <<<"$changed"; then out image=true; else out image=false; fi ;;
  *) out image=true ;;
esac
