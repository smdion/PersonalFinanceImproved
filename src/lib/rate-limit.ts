/**
 * Simple in-memory sliding-window rate limiter.
 * Suitable for a single-process homelab deployment — no Redis needed.
 */

const store = new Map<string, { count: number; resetTime: number }>();

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
 * @returns         `success` false when the limit is exceeded
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { success: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetTime) {
    store.set(key, { count: 1, resetTime: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { success: false, remaining: 0 };
  }
  return { success: true, remaining: limit - entry.count };
}
