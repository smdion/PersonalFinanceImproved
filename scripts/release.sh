#!/usr/bin/env bash
# Release script for Ledgr
#
# Usage: pnpm release <version> [--dry-run]
#   e.g.: pnpm release 0.2.0
#         pnpm release 0.2.0 --dry-run
#
# Runs on main after the release PR is merged (OPS.md § Release Process).
# The version bump is a commit in that PR: this script never commits and
# never pushes a branch, only the tag (main is protected).
#
# Steps:
#   1. Validate version format; package.json must already be at it
#   2. HEAD must be origin/main's tip (the merged release)
#   3. Verify CHANGELOG.md has entry for this version
#   4. Verify lockfile is up to date
#   5. CI is green for HEAD (its push run on main ran the full suite, lint,
#      PostgreSQL and E2E; scripts/ci-gate.ts), then docs verification
#   6. Tag vX.Y.Z on HEAD and push the tag only
#   7. Create GitHub release from CHANGELOG section
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

# Check we're on main, at origin/main's tip
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: releasing from '$BRANCH', not 'main'. Continue? (y/N)${NC}"
  read -r confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
else
  git fetch --no-tags origin main
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo -e "${RED}HEAD isn't origin/main's tip: pull the merged release first.${NC}"
    exit 1
  fi
fi

# Check tag doesn't already exist
# Use refs/tags/$TAG explicitly — a bare `git rev-parse "$TAG"` is ambiguous
# and silently resolves to a same-named branch if one exists (e.g. a release
# branch named after its own version), producing a false positive here.
if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag $TAG already exists.${NC}"
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)

# Step 1: package.json is already at the version (bumped in the release PR)
echo -e "\n${BOLD}[1/7] Checking package.json's version...${NC}"
PKG_VERSION=$(node -p "require('./package.json').version")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo -e "${RED}  package.json is at $PKG_VERSION, not $VERSION.${NC}"
  echo "  Bump it in the release PR (OPS.md § Release Process), merge, then release."
  exit 1
fi
echo -e "${GREEN}  package.json is at $VERSION${NC}"

# Step 2: Verify CHANGELOG has entry
echo -e "\n${BOLD}[2/7] Checking CHANGELOG.md...${NC}"
if ! grep -q "^## .*$VERSION" CHANGELOG.md; then
  echo -e "${RED}  CHANGELOG.md has no entry for $VERSION${NC}"
  echo "  Add a section for $VERSION before releasing."
  exit 1
fi
echo -e "${GREEN}  CHANGELOG.md has entry for $VERSION${NC}"

# Step 3: Verify lockfile is up to date
echo -e "\n${BOLD}[3/7] Checking lockfile...${NC}"
if ! pnpm install --frozen-lockfile --silent 2>/dev/null; then
  echo -e "${RED}  pnpm-lock.yaml is out of sync with package.json${NC}"
  echo "  Run 'pnpm install' and commit the updated lockfile."
  exit 1
fi
echo -e "${GREEN}  Lockfile is up to date${NC}"

# Step 4: CI must be green for the merged commit. Its push run on main ran
# the full suite, lint, PostgreSQL and E2E on CI's Node; running the suite
# here would load the host prod runs on, and dev's Node fails the undici
# tests by design (tests/http/connect-check.test.ts).
echo -e "\n${BOLD}[4/7] Checking CI for ${HEAD_SHA:0:8}...${NC}"
if ! npx tsx scripts/ci-gate.ts "$HEAD_SHA"; then
  echo -e "${RED}  No green CI run for ${HEAD_SHA:0:8} (reason above).${NC}"
  echo "  Wait for main's CI run on the merged commit, then release."
  exit 1
fi
echo -e "${GREEN}  CI green${NC}"

# Step 5: Lint ran in CI (step 4); nothing to run here.
echo -e "\n${BOLD}[5/7] Lint: covered by CI${NC}"

# Step 6: Run docs verification
echo -e "\n${BOLD}[6/7] Verifying docs freshness...${NC}"
if [[ -f "scripts/verify-docs.ts" ]]; then
  pnpm docs:verify || echo -e "${YELLOW}  Docs verification found drift (non-blocking)${NC}"
else
  echo -e "${YELLOW}  verify-docs.ts not found, skipping${NC}"
fi

# --- Dry-run exits here ---
if $DRY_RUN; then
  echo -e "\n${YELLOW}${BOLD}DRY RUN COMPLETE${NC}"
  echo "All validations passed. Would have:"
  echo "  - Tagged $TAG on ${HEAD_SHA:0:8}"
  echo "  - Pushed the tag (no branch)"
  echo "  - Created GitHub release"
  exit 0
fi

# Step 7: Tag and push the tag alone
echo -e "\n${BOLD}[7/7] Tagging $TAG and pushing the tag...${NC}"
git tag -a "$TAG" -m "$TAG"
git push origin "refs/tags/$TAG"
echo -e "${GREEN}  Tagged and pushed${NC}"

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
echo "Prod should already be running $VERSION (deployed before tagging)."
echo "Verify: curl http://localhost:3000/api/health"
