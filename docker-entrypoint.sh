#!/bin/sh
set -e

# Graceful shutdown: forward SIGTERM/SIGINT to the child process so
# Node.js receives the signal and can shut down cleanly. Without this,
# a hung migration would wait for the container kill timeout.
trap 'kill -TERM "$child" 2>/dev/null; wait "$child"' TERM INT

# Pre-migration backup: The auto-versioning system in instrumentation.ts
# creates point-in-time snapshots on startup, providing automatic
# pre-migration recovery points without a separate backup step here.

echo "Running database migrations..."
if ! tsx db-migrate.ts; then
  echo "ERROR: Database migration failed — container cannot start." >&2
  exit 1
fi

echo "Starting server..."
exec node server.js
