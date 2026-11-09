/**
 * In-memory fixed-window rate limiter for a single process. A client straddling
 * a window boundary can get up to 2x the limit in a rolling window.
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
 * Whether `key` is within `limit` requests per `windowMs`. `firstExceedance` is
 * true only on the first rejected request in a window, to log once per window.
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

/** Requests `key` has taken in its current window (0 once it ends). */
export function rateLimitCount(key: string): number {
  const entry = store.get(key);
  return entry && Date.now() < entry.resetTime ? entry.count : 0;
}

/** Forget `key`'s window, so its next request starts a fresh one. */
export function clearRateLimit(key: string): void {
  store.delete(key);
}
