#!/usr/bin/env bash
# CI: the sample compose install, run the way a self-hoster runs it, for
# docker-compose.yml (SQLite) and docker-compose.postgres.yml:
#   1. `docker compose config` refuses to start without .env, and without
#      each required variable, naming it;
#   2. with a throwaway .env it forwards .env's optional variables;
#   3. `docker compose up --build` on an empty volume answers
#      GET /api/health 200 (the entrypoint runs the migrator first).
#
# Usage: bash scripts/ci-image-boot.sh   (writes ./.env, removes it on exit)
# Every value below is a throwaway placeholder, not a secret.
set -euo pipefail

cd "$(dirname "$0")/.."

base_url="http://127.0.0.1:3000"
timeout_s=180
current_file=""
current_project=""
wrote_env=0

fail() {
  echo "::error::$*"
  exit 1
}

if [ -e .env ]; then
  fail ".env already exists here; this script writes a throwaway one. Move yours away first."
fi
# Only .env may supply the variables under test.
unset NEXTAUTH_SECRET CRON_SECRET ENCRYPTION_KEY POSTGRES_PASSWORD

cleanup() {
  status=$?
  if [ -n "$current_file" ]; then
    if [ "$status" -ne 0 ]; then
      echo "::group::Compose logs ($current_file)"
      docker compose -f "$current_file" -p "$current_project" logs --no-color --tail 200 || true
      echo "::endgroup::"
    fi
    docker compose -f "$current_file" -p "$current_project" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  if [ "$wrote_env" = 1 ]; then rm -f ./.env; fi
  exit "$status"
}
trap cleanup EXIT

# Write .env with every placeholder except the one named in $1 (if any).
write_env() {
  local skip="${1:-}" kv
  wrote_env=1
  : > .env
  for kv in \
    "NEXTAUTH_SECRET=ci-placeholder-nextauth-secret-at-least-32-chars" \
    "CRON_SECRET=ci-placeholder-cron-secret-at-least-32-chars" \
    "ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    "POSTGRES_PASSWORD=ci-placeholder-postgres-password" \
    "ALLOWED_ACTUAL_HOSTS=ci-forwarded.invalid"; do
    if [ "${kv%%=*}" != "$skip" ]; then echo "$kv" >> .env; fi
  done
}

# `docker compose config` must fail; with $2 set, the error must name it.
expect_refusal() {
  local file="$1" missing="${2:-}" err
  if err=$(docker compose -f "$file" config 2>&1 >/dev/null); then
    fail "$file: compose accepted a config with ${missing:-no .env} (it must refuse)."
  fi
  if [ -n "$missing" ]; then
    grep -q "$missing" <<<"$err" ||
      fail "$file: compose refused without $missing but didn't name it: $err"
  else
    grep -Eq "NEXTAUTH_SECRET|CRON_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD" <<<"$err" ||
      fail "$file: compose refused without .env but named no required variable: $err"
  fi
  echo "$file: refuses without ${missing:-.env}: ok"
}

check_config() {
  local file="$1" v json got
  shift
  rm -f .env
  expect_refusal "$file"
  for v in "$@"; do
    write_env "$v"
    expect_refusal "$file" "$v"
  done
  write_env
  json=$(docker compose -f "$file" config --format json) ||
    fail "$file: compose refused a complete .env."
  for v in ENCRYPTION_KEY ALLOWED_ACTUAL_HOSTS; do
    got=$(jq -r --arg v "$v" '.services.ledgr.environment[$v] // empty' <<<"$json")
    [ "$got" = "$(grep "^$v=" .env | cut -d= -f2-)" ] ||
      fail "$file: $v from .env doesn't reach the ledgr container (got '${got}')."
  done
  echo "$file: forwards .env (required and optional variables): ok"
}

wait_for_health() {
  local deadline=$((SECONDS + timeout_s)) code=000 restarts
  until [ "$code" = "200" ]; do
    restarts=$(docker inspect -f '{{.RestartCount}}' ledgr 2>/dev/null || echo missing)
    if [ "$restarts" = "missing" ]; then
      fail "$current_file: no ledgr container."
    elif [ "$restarts" != "0" ]; then
      fail "$current_file: the ledgr container restarted ($restarts), so its entrypoint failed (logs below)."
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "$current_file: /api/health did not answer 200 within ${timeout_s}s (last status: ${code})."
    fi
    sleep 2
    code=$(curl -s -o /dev/null -w '%{http_code}' "$base_url/api/health" || true)
  done
  echo "$current_file: /api/health 200 on an empty volume: ok"
}

boot() {
  current_file="$1"
  current_project="$2"
  write_env
  docker compose -f "$current_file" -p "$current_project" up -d --build --quiet-pull
  wait_for_health
  docker compose -f "$current_file" -p "$current_project" down -v --remove-orphans
  current_file=""
}

check_config docker-compose.yml NEXTAUTH_SECRET CRON_SECRET ENCRYPTION_KEY
check_config docker-compose.postgres.yml NEXTAUTH_SECRET CRON_SECRET ENCRYPTION_KEY POSTGRES_PASSWORD

boot docker-compose.yml ledgr-ci-sqlite
boot docker-compose.postgres.yml ledgr-ci-postgres
