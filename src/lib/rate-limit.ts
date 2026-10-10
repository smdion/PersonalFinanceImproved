/**
 * Simple in-memory FIXED-window rate limiter.
 * Suitable for a single-process homelab deployment — no Redis needed.
 *
 * Fixed-window, not sliding: a key's `resetTime` is set once (on its first
 * hit) and `count` accumulates until that instant passes, then resets to 1.
 * The true worst case for a client that straddles a window boundary is up
 * to 2x the configured limit in a rolling 60s (e.g. maxing out the tail of
 * one window, then immediately maxing out the head of the next) — more
 * permissive than the configured number suggests, never less.
 */

const store = new Map<
  string,
  { count: number; resetTime: number; loggedExceeded: boolean }
>();

// Purge expired entries every 60 seconds to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now >= entry.resetTime) store.delete(key);
  });
}, 60_000).unref();

/**
 * Check whether a request identified by `key` is within the rate limit.
 *
 * @param key       Unique identifier (e.g. IP address or session ID)
 * @param limit     Max requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 * @returns         `success` false when the limit is exceeded. `firstExceedance`
 *                  is true only on the FIRST request that crosses the limit
 *                  within the current window — callers can use this to log
 *                  once per key per window instead of once per rejected call.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { success: boolean; remaining: number; firstExceedance: boolean } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetTime) {
    store.set(key, {
      count: 1,
      resetTime: now + windowMs,
      loggedExceeded: false,
    });
    return { success: true, remaining: limit - 1, firstExceedance: false };
  }

  entry.count += 1;
  if (entry.count > limit) {
    const firstExceedance = !entry.loggedExceeded;
    entry.loggedExceeded = true;
    return { success: false, remaining: 0, firstExceedance };
  }
  return {
    success: true,
    remaining: limit - entry.count,
    firstExceedance: false,
  };
}
