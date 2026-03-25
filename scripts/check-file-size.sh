#!/usr/bin/env bash
# Checks that no source file exceeds the line count threshold.
# Used in CI and pre-release checks.

set -euo pipefail

MAX_LINES=2000
WARN_LINES=1500
EXEMPT_FILE=".size-exempt"

# Load exempt list (one path per line)
declare -A exempt
if [[ -f "$EXEMPT_FILE" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    exempt["$line"]=1
  done < "$EXEMPT_FILE"
fi

violations=0
warnings=0

while IFS= read -r file; do
  lines=$(wc -l < "$file")
  rel="${file#./}"

  if [[ -n "${exempt[$rel]:-}" ]]; then
    if (( lines > MAX_LINES )); then
      echo "EXEMPT: $rel has $lines lines (exempt from error, tracked in $EXEMPT_FILE)"
    fi
    continue
  fi

  if (( lines > MAX_LINES )); then
    echo "ERROR: $rel has $lines lines (max $MAX_LINES)"
    violations=$((violations + 1))
  elif (( lines > WARN_LINES )); then
    echo "WARN:  $rel has $lines lines (consider splitting)"
    warnings=$((warnings + 1))
  fi
done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)

echo ""
echo "Summary: $violations errors, $warnings warnings"

if (( violations > 0 )); then
  echo "Add paths to $EXEMPT_FILE to temporarily exempt large files."
  exit 1
fi
