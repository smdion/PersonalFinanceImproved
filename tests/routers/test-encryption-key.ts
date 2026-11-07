/**
 * A per-process ENCRYPTION_KEY for tests, set on import unless one is
 * already set: the app encrypts saved API credentials (budget connections,
 * keys) with it, and production reads it from the container's env. Both
 * harnesses import this first (setup.ts for SQLite, setup-postgres.ts),
 * so a test saving a connection works on either database.
 */
import { randomBytes } from "node:crypto";

if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
}
