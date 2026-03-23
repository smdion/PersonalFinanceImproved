#!/usr/bin/env bash
# Release script for Ledgr
#
# Usage: pnpm release <version>
#   e.g.: pnpm release 0.2.0
#
# Steps:
#   1. Validate version format
#   2. Bump version in package.json
#   3. Verify CHANGELOG.md has entry for this version
#   4. Run full test suite
#   5. Run docs verification
#   6. Commit with "release: vX.Y.Z"
#   7. Tag vX.Y.Z
#   8. Push branch + tag
#   9. Create GitHub release from CHANGELOG section
#
# For container build, see OPS.md (requires SSH to host).

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo -e "${RED}Usage: pnpm release <version>${NC}"
  echo "  e.g.: pnpm release 0.2.0"
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo -e "${RED}Invalid version format: $VERSION${NC}"
  echo "Expected: MAJOR.MINOR.PATCH (e.g., 0.2.0 or 1.0.0-beta.1)"
  exit 1
fi

TAG="v$VERSION"

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
echo -e "\n${BOLD}[1/8] Bumping version to $VERSION...${NC}"
# Use node to update package.json to preserve formatting
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "${GREEN}  package.json updated${NC}"

# Step 2: Verify CHANGELOG has entry
echo -e "\n${BOLD}[2/8] Checking CHANGELOG.md...${NC}"
if ! grep -q "$VERSION" CHANGELOG.md; then
  echo -e "${RED}  CHANGELOG.md has no entry for $VERSION${NC}"
  echo "  Add a section for $VERSION before releasing."
  # Revert package.json
  git checkout package.json
  exit 1
fi
echo -e "${GREEN}  CHANGELOG.md has entry for $VERSION${NC}"

# Step 3: Run tests
echo -e "\n${BOLD}[3/8] Running test suite...${NC}"
pnpm test
echo -e "${GREEN}  All tests passed${NC}"

# Step 4: Run lint
echo -e "\n${BOLD}[4/8] Running lint...${NC}"
pnpm lint
echo -e "${GREEN}  Lint passed${NC}"

# Step 5: Run docs verification
echo -e "\n${BOLD}[5/8] Verifying docs freshness...${NC}"
if [[ -f "scripts/verify-docs.ts" ]]; then
  pnpm docs:verify || echo -e "${YELLOW}  Docs verification found drift (non-blocking)${NC}"
else
  echo -e "${YELLOW}  verify-docs.ts not found, skipping${NC}"
fi

# Step 6: Commit
echo -e "\n${BOLD}[6/8] Committing...${NC}"
git add package.json
git commit -m "release: $TAG"
echo -e "${GREEN}  Committed${NC}"

# Step 7: Tag
echo -e "\n${BOLD}[7/8] Tagging $TAG...${NC}"
git tag -a "$TAG" -m "$TAG"
echo -e "${GREEN}  Tagged${NC}"

# Step 8: Push
echo -e "\n${BOLD}[8/8] Pushing...${NC}"
git push && git push --tags
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
