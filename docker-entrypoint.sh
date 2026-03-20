#!/bin/sh
set -e

# Pre-migration backup: The auto-versioning system in instrumentation.ts
# creates point-in-time snapshots on startup, providing automatic
# pre-migration recovery points without a separate backup step here.

echo "Running database migrations..."
if ! tsx db-migrate.ts; then
  echo "ERROR: Database migration failed — container cannot start." >&2
  exit 1
fi

# exec replaces this shell with node — node becomes PID 1 and receives
# SIGTERM/SIGINT directly from Docker for graceful shutdown.
echo "Starting server..."
exec node server.js
