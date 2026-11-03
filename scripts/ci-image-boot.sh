#!/usr/bin/env bash
# CI: boot the built image on an empty volume with SQLite (the default
# install) and wait for GET /api/health to answer 200. The entrypoint runs
# the migrator first, so this also proves db-migrate.js loads better-sqlite3.
#
# Usage: scripts/ci-image-boot.sh [image]   (default ledgr:ci-test)
# The secrets below are throwaway placeholders, not real values.
set -euo pipefail

image="${1:-ledgr:ci-test}"
name="ledgr-boot-test"
volume="ledgr-boot-test-data"
port=3000
timeout_s=120

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "::group::Container logs ($name)"
    docker logs "$name" 2>&1 | tail -n 200 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null
docker run -d --name "$name" \
  -p "127.0.0.1:${port}:3000" \
  -v "${volume}:/app/data" \
  --read-only --tmpfs /tmp \
  -e NEXTAUTH_URL="http://localhost:${port}" \
  -e NEXTAUTH_SECRET="ci-placeholder-nextauth-secret-at-least-32-chars" \
  -e AUTH_TRUST_HOST=true \
  -e CRON_SECRET="ci-placeholder-cron-secret-at-least-32-chars" \
  -e ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
  "$image" >/dev/null

deadline=$((SECONDS + timeout_s))
code=000
until [ "$code" = "200" ]; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then
    echo "::error::The container exited before /api/health answered (see its logs below)."
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::/api/health did not answer 200 within ${timeout_s}s (last status: ${code})."
    exit 1
  fi
  sleep 2
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/health" || true)
done
echo "/api/health answered 200 on an empty SQLite volume."
