#!/usr/bin/env bash
# Encrypted off-site backup script for ledgr (v0.5 expert-review H9).
#
# Operator runbook (one-time setup, cron config, quarterly restore drill,
# key rotation, failure modes): see .scratch/docs/BACKUP-RUNBOOK.md in the
# operator's local checkout. (.scratch/ is gitignored — the runbook lives
# only on the operator's machine to avoid coupling deployment-specific
# values like SSH targets to public source control.)
#
# Wraps the existing pnpm backup:export with at-rest encryption (age) +
# optional rsync to a remote location. Designed to run from cron on the
# host (NOT inside the ledgr container) for automated daily backups.
#
# Requirements:
#   - age (https://github.com/FiloSottile/age) — install via apt/brew
#   - The ledgr container must be running (or DATABASE_URL accessible)
#   - BACKUP_AGE_RECIPIENT env var: an age public key (age1...)
#     Generate with: age-keygen -o ~/.config/ledgr/backup-key.txt
#     Copy the public key from the file's "Public key" line.
#
# Optional:
#   - BACKUP_REMOTE: rsync destination (e.g. user@host:/backups/ledgr/)
#   - BACKUP_RETENTION_DAYS: how many days of local backups to keep (default 30)
#
# Usage:
#   ./scripts/encrypted-backup.sh
#
# Recommended cron entry (3am daily):
#   0 3 * * * /opt/ledgr/scripts/encrypted-backup.sh >> /var/log/ledgr-backup.log 2>&1
#
# To restore from a backup:
#   age -d -i ~/.config/ledgr/backup-key.txt < backup-2026-04-12.json.age > backup.json
#   pnpm backup:import --in backup.json
#
# Run a quarterly restore drill (see TIER-F-RUNBOOK below) to verify
# backups actually round-trip cleanly.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_FILE="$BACKUP_DIR/ledgr-backup-$TIMESTAMP.json"
ENCRYPTED_FILE="$BACKUP_FILE.age"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() {
  echo -e "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

err() {
  echo -e "${RED}$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: $*${NC}" >&2
}

# ── Pre-flight ────────────────────────────────────────────────────────

if ! command -v age >/dev/null 2>&1; then
  err "'age' not installed. Install with: apt install age (or brew install age)"
  exit 1
fi

if [[ -z "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  err "BACKUP_AGE_RECIPIENT env var is required (an age public key starting with 'age1...')"
  err "Generate one with: age-keygen -o ~/.config/ledgr/backup-key.txt"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Step 1: Export ────────────────────────────────────────────────────

log "Starting backup: $BACKUP_FILE"
cd "$PROJECT_DIR"

if ! pnpm backup:export --out "$BACKUP_FILE" >/dev/null; then
  err "pnpm backup:export failed"
  exit 1
fi

if [[ ! -s "$BACKUP_FILE" ]]; then
  err "Backup file is empty: $BACKUP_FILE"
  exit 1
fi

EXPORT_BYTES="$(wc -c < "$BACKUP_FILE")"
log "Export complete: $EXPORT_BYTES bytes"

# ── Step 2: Encrypt ───────────────────────────────────────────────────

log "Encrypting with age (recipient: ${BACKUP_AGE_RECIPIENT:0:20}...)"
if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$ENCRYPTED_FILE" "$BACKUP_FILE"; then
  err "age encryption failed"
  rm -f "$BACKUP_FILE" "$ENCRYPTED_FILE"
  exit 1
fi

ENCRYPTED_BYTES="$(wc -c < "$ENCRYPTED_FILE")"
log "Encrypted: $ENCRYPTED_BYTES bytes"

# Shred the plaintext (best-effort — dependent on filesystem)
if command -v shred >/dev/null 2>&1; then
  shred -u "$BACKUP_FILE" 2>/dev/null || rm -f "$BACKUP_FILE"
else
  rm -f "$BACKUP_FILE"
fi

# ── Step 3: Off-site copy (optional) ──────────────────────────────────

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  log "Copying to off-site: $BACKUP_REMOTE"
  if ! rsync -a --partial --progress "$ENCRYPTED_FILE" "$BACKUP_REMOTE"; then
    err "rsync to $BACKUP_REMOTE failed (local backup still saved)"
    # Don't exit — local backup is still useful
  else
    log "Off-site copy complete"
  fi
else
  echo -e "${YELLOW}WARNING: BACKUP_REMOTE not set — backup is local only${NC}"
fi

# ── Step 4: Local retention pruning ───────────────────────────────────

log "Pruning local backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name "ledgr-backup-*.json.age" -type f \
  -mtime "+$RETENTION_DAYS" -print -delete 2>/dev/null || true

REMAINING="$(find "$BACKUP_DIR" -name "ledgr-backup-*.json.age" -type f | wc -l)"
log "Local backups remaining: $REMAINING"

echo -e "${GREEN}Backup complete: $ENCRYPTED_FILE${NC}"
