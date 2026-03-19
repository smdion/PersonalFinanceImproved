/**
 * Lightweight error reporting abstraction.
 *
 * Provides a single integration point for error monitoring. The default
 * implementation logs structured JSON to stderr via the app logger.
 * Swap in a real provider (Sentry, OpenTelemetry, etc.) by changing the
 * implementation below — all call sites stay the same.
 *
 * To enable Sentry:
 *   import * as Sentry from '@sentry/nextjs';
 *   Sentry.captureException(error, { extra: context });
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
