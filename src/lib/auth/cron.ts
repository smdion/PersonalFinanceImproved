import { timingSafeEqual } from "node:crypto";

/**
 * Shared cron/internal-endpoint secret validation. `CRON_SECRET` must be at
 * least 32 characters; the comparison is constant-time to avoid a timing
 * oracle on these unauthenticated-by-default routes.
 */

export function getValidCronSecret(): string | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 32) return null;
  return cronSecret;
}

export function timingSafeSecretMatch(
  provided: string | null,
  expected: string,
): boolean {
  const providedBuf = provided
    ? Buffer.from(provided, "utf8")
    : Buffer.alloc(0);
  const expectedBuf = Buffer.from(expected, "utf8");
  return (
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf)
  );
}

/** Validates the `X-Cron-Secret` header used by the daily/startup cron routes. */
export function validateCronHeaderRequest(request: Request): boolean {
  const cronSecret = getValidCronSecret();
  if (!cronSecret) return false;
  return timingSafeSecretMatch(
    request.headers.get("X-Cron-Secret"),
    cronSecret,
  );
}

/** Validates the `Authorization: Bearer` header used by `health/detailed`. */
export function validateCronBearerRequest(request: Request): boolean {
  const cronSecret = getValidCronSecret();
  if (!cronSecret) return false;
  const auth = request.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  return timingSafeSecretMatch(provided, cronSecret);
}
