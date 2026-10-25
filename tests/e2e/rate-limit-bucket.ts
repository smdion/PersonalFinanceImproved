import type { test as playwrightTest } from "@playwright/test";

/**
 * Give each test in a spec its own rate-limit bucket. The API limits
 * requests per visitor address (x-forwarded-for, set by the reverse proxy in
 * production); CI has no proxy, so without this every test in the run
 * shares ONE bucket and a page-heavy spec (the privacy route scan loads
 * ~26 pages) can spend it for whatever runs next.
 */
export function useOwnRateLimitBucket(
  test: typeof playwrightTest,
  spec: string,
) {
  test.beforeEach(async ({ context }, info) => {
    let h = 0;
    for (const ch of `${spec}:${info.title}:${info.retry}`)
      h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${h & 255}`,
    });
  });
}
