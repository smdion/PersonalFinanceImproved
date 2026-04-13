#!/bin/bash
# Runs pnpm docs:verify when Claude edits files whose counts/listings appear
# in DESIGN.md auto-gen markers. Keeps the markers from drifting silently.
#
# Exit codes:
#   0 — file out of scope, or docs in sync
#   2 — drift detected (Claude Code surfaces stderr to the assistant on exit 2)

FILE_PATH=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

if [[ "$FILE_PATH" =~ src/lib/calculators/engine/|src/server/routers/|src/lib/db/schema|src/lib/config/account-types|src/components/ui/|src/components/cards/dashboard/|drizzle/ ]]; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  if ! VERIFY_OUT=$(pnpm docs:verify 2>&1); then
    {
      echo "DOCS DRIFT detected after editing $FILE_PATH"
      echo "Run 'pnpm docs:update' to rewrite the auto-gen markers, then commit."
      echo "---"
      echo "$VERIFY_OUT" | tail -20
    } >&2
    exit 2
  fi
fi

exit 0
