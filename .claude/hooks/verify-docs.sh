#!/bin/bash
# Runs pnpm docs:verify when Claude edits files whose counts/listings appear
# in DESIGN.md auto-gen markers. Also regenerates docs/API_ROUTERS.md and
# docs/SCHEMA.md when routers or schema files change — docs:verify does NOT
# cover those two files, so without this they drift silently (they went
# unregenerated for 4 months / 23 router commits before this was added).
#
# Exit codes:
#   0 — file out of scope, or docs in sync
#   2 — drift detected / regen failed (Claude Code surfaces stderr to the assistant on exit 2)

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

# API_ROUTERS.md / SCHEMA.md mirror routers/ and schema files specifically —
# regenerate them directly rather than relying on docs:verify.
if [[ "$FILE_PATH" =~ src/server/routers/|src/lib/db/schema ]]; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  if ! GEN_OUT=$(pnpm docs:gen-api 2>&1); then
    {
      echo "docs:gen-api FAILED after editing $FILE_PATH — API_ROUTERS.md/SCHEMA.md may be stale"
      echo "---"
      echo "$GEN_OUT" | tail -20
    } >&2
    exit 2
  fi
fi

exit 0
