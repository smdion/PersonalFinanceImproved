#!/bin/sh
set -e

# Restrict file permissions for SQLite database files (owner-only)
umask 0077

# Pre-migration backup: db-migrate.js writes one (pre-upgrade-backup-*.json
# for PostgreSQL, an exact .db copy for SQLite, in LEDGR_BACKUP_DIR or
# /app/data) before changing an existing database, and refuses to migrate if
# it can't. (The auto-versions created on startup run after migrating, so
# they are not pre-migration recovery points.)

echo "Running database migrations..."
if ! node db-migrate.js; then
  echo "ERROR: Database migration failed — container cannot start." >&2
  exit 1
fi

# exec replaces this shell with node — node becomes PID 1 and receives
# SIGTERM/SIGINT directly from Docker for graceful shutdown.
echo "Starting server..."
exec node server.js
