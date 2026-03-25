#!/usr/bin/env bash
# Release script for Ledgr
#
# Usage: pnpm release <version> [--dry-run]
#   e.g.: pnpm release 0.2.0
#         pnpm release 0.2.0 --dry-run
#
# Steps:
#   1. Validate version format
#   2. Bump version in package.json
#   3. Verify CHANGELOG.md has entry for this version
#   4. Verify lockfile is up to date
#   5. Run full test suite
#   6. Run docs verification
#   7. Commit with "release: vX.Y.Z"
#   8. Tag vX.Y.Z
#   9. Push branch + tag
#  10. Create GitHub release from CHANGELOG section
#
# For container build, see OPS.md (requires SSH to host).

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

# Parse arguments
DRY_RUN=false
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -*) echo -e "${RED}Unknown flag: $arg${NC}"; exit 1 ;;
    *) VERSION="$arg" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo -e "${RED}Usage: pnpm release <version> [--dry-run]${NC}"
  echo "  e.g.: pnpm release 0.2.0"
  echo "        pnpm release 0.2.0 --dry-run"
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo -e "${RED}Invalid version format: $VERSION${NC}"
  echo "Expected: MAJOR.MINOR.PATCH (e.g., 0.2.0 or 1.0.0-beta.1)"
  exit 1
fi

TAG="v$VERSION"

if $DRY_RUN; then
  echo -e "${YELLOW}DRY RUN — no commits, tags, or pushes will be made${NC}"
  echo ""
fi

echo -e "${BOLD}Releasing Ledgr $TAG${NC}"
echo "=============================="

# Check for clean working directory
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${RED}Working directory is not clean. Commit or stash changes first.${NC}"
  git status --short
  exit 1
fi

# Check we're on main
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: releasing from '$BRANCH', not 'main'. Continue? (y/N)${NC}"
  read -r confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag $TAG already exists.${NC}"
  exit 1
fi

# Step 1: Bump version in package.json
echo -e "\n${BOLD}[1/9] Bumping version to $VERSION...${NC}"
# Use node to update package.json to preserve formatting
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "${GREEN}  package.json updated${NC}"

# Step 2: Verify CHANGELOG has entry
echo -e "\n${BOLD}[2/9] Checking CHANGELOG.md...${NC}"
if ! grep -q "^## .*$VERSION" CHANGELOG.md; then
  echo -e "${RED}  CHANGELOG.md has no entry for $VERSION${NC}"
  echo "  Add a section for $VERSION before releasing."
  # Revert package.json
  git checkout package.json
  exit 1
fi
echo -e "${GREEN}  CHANGELOG.md has entry for $VERSION${NC}"

# Step 3: Verify lockfile is up to date
echo -e "\n${BOLD}[3/9] Checking lockfile...${NC}"
if ! pnpm install --frozen-lockfile --silent 2>/dev/null; then
  echo -e "${RED}  pnpm-lock.yaml is out of sync with package.json${NC}"
  echo "  Run 'pnpm install' and commit the updated lockfile."
  git checkout package.json
  exit 1
fi
echo -e "${GREEN}  Lockfile is up to date${NC}"

# Step 4: Run tests
echo -e "\n${BOLD}[4/9] Running test suite...${NC}"
pnpm test
echo -e "${GREEN}  All tests passed${NC}"

# Step 5: Run lint
echo -e "\n${BOLD}[5/9] Running lint...${NC}"
pnpm lint
echo -e "${GREEN}  Lint passed${NC}"

# Step 6: Run docs verification
echo -e "\n${BOLD}[6/9] Verifying docs freshness...${NC}"
if [[ -f "scripts/verify-docs.ts" ]]; then
  pnpm docs:verify || echo -e "${YELLOW}  Docs verification found drift (non-blocking)${NC}"
else
  echo -e "${YELLOW}  verify-docs.ts not found, skipping${NC}"
fi

# --- Dry-run exits here ---
if $DRY_RUN; then
  echo -e "\n${YELLOW}${BOLD}DRY RUN COMPLETE${NC}"
  echo "All validations passed. Would have:"
  echo "  - Committed release: $TAG"
  echo "  - Tagged $TAG"
  echo "  - Pushed with --follow-tags"
  echo "  - Created GitHub release"
  # Revert package.json bump
  git checkout package.json
  exit 0
fi

# Step 7: Commit (skip if version was already bumped in a prior commit)
echo -e "\n${BOLD}[7/9] Committing...${NC}"
git add package.json
if git diff --cached --quiet; then
  echo -e "${YELLOW}  package.json already at $VERSION — skipping release commit${NC}"
else
  git commit -m "release: $TAG"
  echo -e "${GREEN}  Committed${NC}"
fi

# Step 8: Tag
echo -e "\n${BOLD}[8/9] Tagging $TAG...${NC}"
git tag -a "$TAG" -m "$TAG"
echo -e "${GREEN}  Tagged${NC}"

# Step 9: Push
echo -e "\n${BOLD}[9/9] Pushing...${NC}"
git push --follow-tags
echo -e "${GREEN}  Pushed${NC}"

# GitHub release (if gh is available)
echo ""
if command -v gh >/dev/null 2>&1; then
  echo -e "${BOLD}Creating GitHub release...${NC}"
  # Extract CHANGELOG section for this version
  NOTES=$(awk "/^## .*$VERSION/{found=1; next} /^## /{if(found) exit} found{print}" CHANGELOG.md)
  if [[ -n "$NOTES" ]]; then
    PRERELEASE_FLAG=""
    if [[ "$VERSION" == *-* ]]; then
      PRERELEASE_FLAG="--prerelease"
    fi
    echo "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file - $PRERELEASE_FLAG
    echo -e "${GREEN}  GitHub release created${NC}"
  else
    echo -e "${YELLOW}  Could not extract CHANGELOG section — create release manually${NC}"
    echo "  gh release create $TAG --title \"$TAG\" --notes-file CHANGELOG.md"
  fi
else
  echo -e "${YELLOW}gh CLI not found. Create GitHub release manually:${NC}"
  echo "  gh release create $TAG --title \"$TAG\" --notes-file CHANGELOG.md"
fi

echo -e "\n${GREEN}${BOLD}Release $TAG complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Build container: see .scratch/docs/OPS.md § Container Build & Deploy"
echo "  2. Verify: curl http://localhost:3000/api/health"
