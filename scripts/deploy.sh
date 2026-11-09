#!/usr/bin/env bash
# Deploy script for Ledgr
#
# Usage: pnpm deploy <version> [--skip-demo] [--force] [--skip-ci-gate] [--dry-run]
#   e.g.: pnpm deploy 0.3.2
#         pnpm deploy 0.3.2 --skip-demo   # skip demo health check
#         pnpm deploy 0.3.2 --force       # deploy despite a version mismatch
#                                         # or uncommitted changes
#         pnpm deploy 0.3.2 --skip-ci-gate  # deploy without a green CI run
#         pnpm deploy 0.3.2 --dry-run     # run the local checks (version, CI,
#                                         # clean tree), then stop: no SSH, no
#                                         # build; .env.deploy not needed
#
# Configuration: create .env.deploy (gitignored) with:
#   DEPLOY_SSH_KEY=/path/to/ssh/key
#   DEPLOY_SSH_HOST=user@host
#   DEPLOY_BUILD_DIR=/path/to/source
#   DEPLOY_STACK_DIR=/path/to/compose
#   DEPLOY_PROD_CONTAINER=ledgr
#   DEPLOY_DEMO_CONTAINER=ledgrdemo
#
# Steps:
#   1. Validate version matches package.json (bump it on the feature branch
#      before running this — the git tag does NOT need to exist yet), and
#      refuse unless CI is green for HEAD's commit (scripts/ci-gate.ts: the
#      newest push run of ci.yml, every job in it, PostgreSQL included)
#   2. Build Docker image on host (tagged as ledgr:X.Y.Z + ledgr:latest)
#   3. Restart demo container first (canary)
#   4. Health-check demo
#   5. Restart prod container
#   6. Health-check prod
#   7. Prune old images (keep N-1), then dangling images and build cache
#
# In the deploy-then-release flow, this script runs from the feature branch
# BEFORE the release tag exists. After smoke-testing the deployed prod, merge
# the PR to main and run `pnpm release X.Y.Z` to tag/publish.
#
# Requires SSH access to the host VM. See OPS.md § Release Process.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

# --- Parse arguments ---
VERSION=""
SKIP_DEMO=false
FORCE=false
SKIP_CI_GATE=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --skip-demo) SKIP_DEMO=true ;;
    --force) FORCE=true ;;
    --skip-ci-gate) SKIP_CI_GATE=true ;;
    --dry-run) DRY_RUN=true ;;
    -*) echo -e "${RED}Unknown flag: $arg${NC}"; exit 1 ;;
    *) VERSION="$arg" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo -e "${RED}Usage: pnpm deploy <version> [--skip-demo] [--force] [--skip-ci-gate] [--dry-run]${NC}"
  echo "  e.g.: pnpm deploy 0.3.2"
  exit 1
fi

# --- Load configuration from .env.deploy ---
ENV_FILE="$(dirname "$0")/../.env.deploy"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
elif $DRY_RUN; then
  echo -e "${YELLOW}--dry-run: no .env.deploy; host settings shown as placeholders${NC}"
  DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-<ssh-key>}"
  DEPLOY_SSH_HOST="${DEPLOY_SSH_HOST:-<user@host>}"
  DEPLOY_BUILD_DIR="${DEPLOY_BUILD_DIR:-<build-dir>}"
  DEPLOY_STACK_DIR="${DEPLOY_STACK_DIR:-<stack-dir>}"
else
  echo -e "${RED}.env.deploy not found at $ENV_FILE${NC}"
  echo ""
  echo "Create .env.deploy (gitignored) with your deployment config:"
  echo "  DEPLOY_SSH_KEY=/path/to/ssh/key"
  echo "  DEPLOY_SSH_HOST=user@host"
  echo "  DEPLOY_BUILD_DIR=/path/to/source/on/host"
  echo "  DEPLOY_STACK_DIR=/path/to/compose/on/host"
  echo "  DEPLOY_PROD_CONTAINER=ledgr"
  echo "  DEPLOY_DEMO_CONTAINER=ledgrdemo"
  exit 1
fi

# --- Configuration (from .env.deploy with defaults) ---
SSH_KEY="${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY not set in .env.deploy}"
SSH_HOST="${DEPLOY_SSH_HOST:?DEPLOY_SSH_HOST not set in .env.deploy}"
BUILD_DIR="${DEPLOY_BUILD_DIR:?DEPLOY_BUILD_DIR not set in .env.deploy}"
STACK_DIR="${DEPLOY_STACK_DIR:?DEPLOY_STACK_DIR not set in .env.deploy}"
PROD_CONTAINER="${DEPLOY_PROD_CONTAINER:-ledgr}"
DEMO_CONTAINER="${DEPLOY_DEMO_CONTAINER:-ledgrdemo}"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 $SSH_HOST"
HEALTH_TIMEOUT=30
HEALTH_INTERVAL=5

TAG="v$VERSION"

if $DRY_RUN; then
  echo -e "${BOLD}Deploying Ledgr $TAG (dry run)${NC}"
else
  echo -e "${BOLD}Deploying Ledgr $TAG${NC}"
fi
echo "=============================="

# --- Preflight checks ---

# 1. Verify SSH key exists
if ! $DRY_RUN && [[ ! -f "$SSH_KEY" ]]; then
  echo -e "${RED}SSH key not found at $SSH_KEY${NC}"
  echo "Extract from vault first — see OPS.md § Container Build & Deploy"
  exit 1
fi

# 2. Verify version matches package.json
PKG_VERSION=$(node -e "console.log(require('./package.json').version)")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo -e "${RED}Version mismatch: package.json=$PKG_VERSION, requested=$VERSION${NC}"
  if ! $FORCE; then
    echo "Use --force to override"
    exit 1
  fi
  echo -e "${YELLOW}--force: continuing despite mismatch${NC}"
fi

# 3. The projection cache's engine hash must match the code: a stale one
#    would serve cached projections from other code. --force doesn't skip it.
if ! pnpm -s check:engine-hash; then
  echo -e "${RED}Refusing to deploy: run 'pnpm engine-hash' and commit the result.${NC}"
  exit 1
fi

# 4. CI must be green for the commit being deployed. Without a green run
#    (none yet, still running, failed, or a job missing), refuse;
#    --skip-ci-gate (never --force) deploys anyway with a warning.
HEAD_SHA=$(git rev-parse HEAD)
echo "Checking CI for ${HEAD_SHA:0:8}..."
if npx tsx scripts/ci-gate.ts "$HEAD_SHA"; then
  echo -e "${GREEN}  CI green${NC}"
elif $SKIP_CI_GATE; then
  echo -e "${YELLOW}${BOLD}WARNING: --skip-ci-gate: deploying ${HEAD_SHA:0:8} WITHOUT a green CI run.${NC}"
  echo -e "${YELLOW}  This commit has no passing CI run.${NC}"
else
  echo -e "${RED}Refusing to deploy ${HEAD_SHA:0:8}: no green CI run (reason above).${NC}"
  echo "Push the commit and wait for CI, or use --skip-ci-gate to deploy anyway"
  exit 1
fi

# (Tag check removed — in the deploy-then-release flow, the tag is created
#    AFTER deploy by `pnpm release`. The version is already in package.json,
#    so the build will bake it in correctly.)

# 5. Verify clean working directory (source on host is bind-mounted)
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${YELLOW}Warning: working directory has uncommitted changes${NC}"
  if ! $FORCE; then
    echo "Commit or stash changes, or use --force to deploy anyway"
    exit 1
  fi
fi

if $DRY_RUN; then
  echo -e "\n${GREEN}${BOLD}Dry run: the checks passed; stopping before SSH.${NC}"
  echo "A deploy would now build ledgr:$VERSION on $SSH_HOST, restart $DEMO_CONTAINER then $PROD_CONTAINER, and prune."
  exit 0
fi

# 6. Verify host is reachable
echo -e "\n${BOLD}[1/6] Checking host connectivity...${NC}"
if ! $SSH_CMD "echo ok" >/dev/null 2>&1; then
  echo -e "${RED}Cannot reach $SSH_HOST — check SSH key and network${NC}"
  exit 1
fi
echo -e "${GREEN}  Host reachable${NC}"

# --- Build ---

echo -e "\n${BOLD}[2/6] Building Docker image (ledgr:$VERSION)...${NC}"
$SSH_CMD "docker build --build-arg APP_VERSION=$VERSION -t ledgr:$VERSION -t ledgr:latest $BUILD_DIR"
echo -e "${GREEN}  Built ledgr:$VERSION + ledgr:latest${NC}"

# --- Health check helper ---
check_health() {
  local container="$1"
  local elapsed=0

  while [[ $elapsed -lt $HEALTH_TIMEOUT ]]; do
    $SSH_CMD "docker exec $container node -e \"const http=require('http');http.get('http://localhost:3000/api/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);process.exit(j.status==='ok'?0:1)})}).on('error',()=>process.exit(1))\"" 2>/dev/null && return 0
    sleep $HEALTH_INTERVAL
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done
  return 1
}

# --- Canary: deploy demo first ---

if ! $SKIP_DEMO; then
  echo -e "\n${BOLD}[3/6] Deploying demo (canary)...${NC}"
  $SSH_CMD "cd $STACK_DIR && sudo docker compose up -d $DEMO_CONTAINER"
  echo -e "  Waiting for health check..."
  if check_health "$DEMO_CONTAINER"; then
    echo -e "${GREEN}  Demo healthy${NC}"
  else
    echo -e "${RED}  Demo failed health check after ${HEALTH_TIMEOUT}s${NC}"
    echo -e "${RED}  Aborting — prod was NOT updated${NC}"
    echo ""
    echo "Debug: $SSH_CMD \"docker logs $DEMO_CONTAINER --tail 30\""
    exit 1
  fi
else
  echo -e "\n${YELLOW}[3/6] Skipping demo (--skip-demo)${NC}"
fi

# --- Deploy prod ---

echo -e "\n${BOLD}[4/6] Deploying prod...${NC}"
$SSH_CMD "cd $STACK_DIR && sudo docker compose up -d $PROD_CONTAINER"
echo -e "  Waiting for health check..."
if check_health "$PROD_CONTAINER"; then
  echo -e "${GREEN}  Prod healthy${NC}"
else
  echo -e "${RED}  Prod failed health check after ${HEALTH_TIMEOUT}s${NC}"
  echo ""
  echo "Debug: $SSH_CMD \"docker logs $PROD_CONTAINER --tail 30\""
  echo ""
  echo -e "${YELLOW}Rollback: see instructions at end of deploy output${NC}"
  exit 1
fi

# --- Verify version ---

echo -e "\n${BOLD}[5/6] Verifying deployed version...${NC}"
DEPLOYED_VERSION=$($SSH_CMD "docker exec $PROD_CONTAINER node -e \"const http=require('http');http.get('http://localhost:3000/api/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(JSON.parse(d).version))}).on('error',e=>console.error(e))\"" 2>/dev/null || echo "unknown")

if [[ "$DEPLOYED_VERSION" == "$VERSION" ]]; then
  echo -e "${GREEN}  Version confirmed: $DEPLOYED_VERSION${NC}"
else
  echo -e "${YELLOW}  Version mismatch: expected=$VERSION, got=$DEPLOYED_VERSION${NC}"
  echo "  Check APP_VERSION build arg"
fi

# --- Cleanup old images ---

echo -e "\n${BOLD}[6/6] Cleaning up old images...${NC}"
# Keep current version, previous version, and latest tag
OLD_IMAGES=$($SSH_CMD "docker images ledgr --format '{{.Tag}}' | grep -v -x -F '$VERSION' | grep -v -x -F 'latest' | grep -v -x -F '<none>' | sort -V | head -n -1" 2>/dev/null || true)
if [[ -n "$OLD_IMAGES" ]]; then
  for old_tag in $OLD_IMAGES; do
    echo "  Removing ledgr:$old_tag"
    $SSH_CMD "docker rmi ledgr:$old_tag" 2>/dev/null || true
  done
else
  echo -e "  No old images to clean"
fi

# Build leftovers: each build leaves 2-3 GB of untagged layers and build
# cache. `docker image prune -f` (no -a) removes dangling images only:
# untagged and not used by any container. A tagged image is never dangling,
# so ledgr:$VERSION, ledgr:latest and the previous ledgr tag kept above (the
# no-migration rollback retags it) stay, and so does any layer they use.
# `docker builder prune -f` removes unused build cache, never an image; the
# next build runs cold. A failed prune doesn't fail the deploy.
echo "  Pruning dangling images and build cache"
$SSH_CMD "docker image prune -f" 2>/dev/null | tail -n 1 || true
$SSH_CMD "docker builder prune -f" 2>/dev/null | tail -n 1 || true
echo "  Kept: $($SSH_CMD "docker images ledgr --format '{{.Tag}}'" 2>/dev/null | tr '\n' ' ' || true)"

echo -e "\n${GREEN}${BOLD}Deploy $TAG complete!${NC}"
echo ""
echo "Rollback (if needed; a release with a migration restores the pre-deploy"
echo "dump first, see docs/OPS.md § Rollback):"
echo "  1. Find previous version: $SSH_CMD \"docker images ledgr --format '{{.Tag}}'\""
echo "  2. Retag: $SSH_CMD \"docker tag ledgr:X.Y.Z ledgr:latest\""
echo "  3. Restart: $SSH_CMD \"cd $STACK_DIR && sudo docker compose up -d $PROD_CONTAINER $DEMO_CONTAINER\""
