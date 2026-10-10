import { describe, it, expect, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows the first request for a fresh key", () => {
    const key = `test-${crypto.randomUUID()}`;
    const result = rateLimit(key, 5, 60_000);
    expect(result).toEqual({
      success: true,
      remaining: 4,
      firstExceedance: false,
    });
  });

  it("counts down remaining as requests accumulate within the window", () => {
    const key = `test-${crypto.randomUUID()}`;
    rateLimit(key, 3, 60_000);
    rateLimit(key, 3, 60_000);
    const third = rateLimit(key, 3, 60_000);
    expect(third).toEqual({
      success: true,
      remaining: 0,
      firstExceedance: false,
    });
  });

  it("rejects once the limit is exceeded", () => {
    const key = `test-${crypto.randomUUID()}`;
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    const rejected = rateLimit(key, 2, 60_000);
    expect(rejected.success).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  it("firstExceedance is true only on the FIRST request that crosses the limit, not subsequent rejections in the same window", () => {
    const key = `test-${crypto.randomUUID()}`;
    rateLimit(key, 1, 60_000); // succeeds (1/1)
    const firstRejection = rateLimit(key, 1, 60_000); // exceeds -> first time
    const secondRejection = rateLimit(key, 1, 60_000); // still exceeded, already logged once
    const thirdRejection = rateLimit(key, 1, 60_000);

    expect(firstRejection.success).toBe(false);
    expect(firstRejection.firstExceedance).toBe(true);
    expect(secondRejection.success).toBe(false);
    expect(secondRejection.firstExceedance).toBe(false);
    expect(thirdRejection.success).toBe(false);
    expect(thirdRejection.firstExceedance).toBe(false);
  });

  it("resets the count and firstExceedance flag once the window elapses (fixed window, not sliding)", () => {
    vi.useFakeTimers();
    try {
      const key = `test-${crypto.randomUUID()}`;
      rateLimit(key, 1, 1_000); // succeeds
      const rejected = rateLimit(key, 1, 1_000); // exceeds, firstExceedance
      expect(rejected.firstExceedance).toBe(true);

      vi.advanceTimersByTime(1_001);

      // New window: count resets to 1, and a fresh exceedance in THIS
      // window would report firstExceedance again -- proves the flag is
      // per-window, not per-key-forever.
      const afterReset = rateLimit(key, 1, 1_000);
      expect(afterReset).toEqual({
        success: true,
        remaining: 0,
        firstExceedance: false,
      });
      const exceedsAgain = rateLimit(key, 1, 1_000);
      expect(exceedsAgain.firstExceedance).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("different keys never share a bucket", () => {
    const keyA = `test-a-${crypto.randomUUID()}`;
    const keyB = `test-b-${crypto.randomUUID()}`;
    rateLimit(keyA, 1, 60_000);
    const rejectedA = rateLimit(keyA, 1, 60_000);
    const stillOkB = rateLimit(keyB, 1, 60_000);

    expect(rejectedA.success).toBe(false);
    expect(stillOkB.success).toBe(true);
  });

  it("fixed-window worst case: a client straddling the boundary can get up to 2x the limit in a rolling window, never fewer", () => {
    // Documents the fixed-window (not sliding) behavior noted in
    // rate-limit.ts's own comment: maxing out the tail of one window and
    // immediately maxing out the head of the next is allowed. This is
    // MORE permissive than the configured limit suggests, never less --
    // the limiter can't be stricter than intended.
    vi.useFakeTimers();
    try {
      const key = `test-${crypto.randomUUID()}`;
      const limit = 2;
      const windowMs = 1_000;

      // Exhaust the first window entirely.
      expect(rateLimit(key, limit, windowMs).success).toBe(true);
      expect(rateLimit(key, limit, windowMs).success).toBe(true);
      expect(rateLimit(key, limit, windowMs).success).toBe(false);

      // Cross into the next window and exhaust it too -- 4 successes
      // total (2x the limit) within a bit over one window's duration.
      vi.advanceTimersByTime(windowMs + 1);
      expect(rateLimit(key, limit, windowMs).success).toBe(true);
      expect(rateLimit(key, limit, windowMs).success).toBe(true);
      expect(rateLimit(key, limit, windowMs).success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
