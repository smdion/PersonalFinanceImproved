/**
 * Single integration point for error monitoring; logs structured JSON to
 * stderr via the app logger. Swap the implementation below for a real provider.
 */

import { log } from "@/lib/logger";

/**
 * Report an error with optional structured context.
 *
 * Use this instead of bare console.error so all errors flow through
 * a single point that can be redirected to an external service later.
 */
export function reportError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  log("error", "unhandled_error", {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}
