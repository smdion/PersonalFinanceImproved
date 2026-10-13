/**
 * Runs once before any test file. Rebuilds the Monte Carlo worker bundle
 * (`monte-carlo-worker.js`, gitignored) so tests that spawn the real
 * worker — tests/server/helpers/monte-carlo-worker-client.test.ts — run
 * today's engine code, not a stale bundle left over from an older
 * `pnpm dev`, and so a clean checkout (CI) has it at all. esbuild takes
 * well under a second, so always rebuilding beats a staleness check.
 */
import { execFileSync } from "node:child_process";

export default function setup() {
  // Output to stderr only: the admin testing router parses vitest's JSON
  // reporter from stdout.
  execFileSync("pnpm", ["-s", "build:mc-worker"], {
    stdio: ["ignore", process.stderr, process.stderr],
  });
}
