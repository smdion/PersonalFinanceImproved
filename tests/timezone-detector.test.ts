/**
 * Detector for the whole "local day vs UTC day" bug class (TODO.md's
 * 2026-09-01 date-parsing audit; `d030f43`/`1fbc436`/`4ffd6a0` on v0.8.3).
 *
 * `vitest.config.ts` pins `process.env.TZ = "UTC"` for the entire suite —
 * necessary for determinism, but it also means "local time" and "UTC time"
 * are IDENTICAL for every other test in the repo, so a helper that
 * accidentally mixes UTC-based and local-based date math (the exact bug
 * these helpers exist to prevent) would pass every existing test anyway.
 * This file is the one place that runs under a REAL behind-UTC zone
 * (America/Chicago, UTC-5 in September) so that class of bug has an actual
 * chance to fail a test. Kept as its own file (not mirrored into
 * tests/helpers/date.test.ts etc.) so the env-var override can't leak into
 * unrelated tests via ordering — Node's `Date` local getters/constructor
 * read `process.env.TZ` live, so flipping it in beforeAll/afterAll here is
 * enough; no extra mocking library needed.
 *
 * NOT a substitute for a real production check across other timezones —
 * one zone is enough to prove local-vs-UTC handling isn't accidentally
 * UTC-only; it doesn't cover DST-transition edge cases or zones on the
 * other side of the date line from UTC.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Pulled in by projection-cache.ts for the (unused, in this file) DB-backed
// cache read/write functions — mocked so importing hashEngineInput/
// canonicalize doesn't require a live dialect-resolved DB connection.
vi.mock("@/lib/db/schema", () => ({}));

describe("timezone detector (America/Chicago, UTC-5)", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Chicago";
  });

  afterAll(() => {
    if (originalTz !== undefined) {
      process.env.TZ = originalTz;
    } else {
      delete process.env.TZ;
    }
  });

  describe("localDateStr", () => {
    it("reads the CHICAGO calendar day for a fixed UTC instant, not the UTC day", async () => {
      const { localDateStr } = await import("@/lib/utils/date");
      // 2026-09-07T02:00:00Z is 2026-09-06 21:00 in Chicago (UTC-5) — still
      // "the 6th" locally, even though UTC has already rolled to the 7th.
      // The old bug (`.toISOString().slice(0, 10)`) would report "2026-09-07"
      // here; local getters correctly report "2026-09-06".
      const instant = new Date("2026-09-07T02:00:00.000Z");
      expect(localDateStr(instant)).toBe("2026-09-06");
    });
  });

  describe("parseLocalDateOnly", () => {
    it("round-trips a date-only string through localDateStr under a non-UTC zone", async () => {
      const { localDateStr, parseLocalDateOnly } =
        await import("@/lib/utils/date");
      // The bug this module exists to prevent: `new Date("2026-09-06")`
      // unguarded parses as UTC midnight, which reads back as "2026-09-05"
      // under any timezone behind UTC (all of the US). Guarded parsing must
      // reproduce the SAME calendar date regardless of host timezone.
      expect(localDateStr(parseLocalDateOnly("2026-09-06"))).toBe("2026-09-06");
      expect(localDateStr(parseLocalDateOnly("2026-01-01"))).toBe("2026-01-01");
    });
  });

  describe("filterActiveJobsAtDate", () => {
    it("does not activate a job on its start DATE until CHICAGO local midnight, not UTC midnight", async () => {
      const { filterActiveJobsAtDate } = await import("@/lib/pure/performance");
      const job = {
        startDate: "2026-09-07",
        endDate: null,
        isSpeculative: false,
      };
      // 2026-09-07T02:00:00Z is 2026-09-06 21:00 Chicago -- 3 hours before
      // this job's start date reaches Chicago local midnight (2026-09-07T05:00Z).
      // A UTC-midnight parse of "2026-09-07" (00:00Z) would wrongly place
      // this asOfDate AFTER the job's start.
      const beforeChicagoMidnight = new Date("2026-09-07T02:00:00.000Z");
      expect(filterActiveJobsAtDate([job], beforeChicagoMidnight)).toEqual([]);

      // 2026-09-07T06:00:00Z is 2026-09-07 01:00 Chicago -- an hour past
      // Chicago local midnight, so the job is active now.
      const afterChicagoMidnight = new Date("2026-09-07T06:00:00.000Z");
      expect(filterActiveJobsAtDate([job], afterChicagoMidnight)).toEqual([
        job,
      ]);
    });
  });

  describe("hashEngineInput (day-granularity canonicalization)", () => {
    it("hashes two instants on the SAME Chicago calendar day identically, even straddling UTC midnight", async () => {
      const { hashEngineInput } =
        await import("@/server/helpers/projection-cache");
      // Both are 2026-09-06 in Chicago: 9pm and 11:55pm local. The second is
      // already 2026-09-07 in UTC (04:55Z) — the cache key must still agree,
      // since day-granularity is defined in the engine's local-time
      // convention (see canonicalize's own comment), not UTC.
      const earlyEvening = new Date("2026-09-07T02:00:00.000Z"); // 9pm Chicago 9/6
      const lateNight = new Date("2026-09-07T04:55:00.000Z"); // 11:55pm Chicago 9/6
      const a = hashEngineInput("deterministic", { asOfDate: earlyEvening });
      const b = hashEngineInput("deterministic", { asOfDate: lateNight });
      expect(a).toBe(b);
    });

    it("hashes two instants on DIFFERENT Chicago calendar days differently, even on the SAME UTC day", async () => {
      const { hashEngineInput } =
        await import("@/server/helpers/projection-cache");
      // 2026-09-07T04:55:00Z = 2026-09-06 11:55pm Chicago.
      // 2026-09-07T05:05:00Z = 2026-09-07 12:05am Chicago.
      // Both are 2026-09-07 in UTC -- a UTC-day cache key would collide
      // these; the local-day key must not.
      const beforeChicagoMidnight = new Date("2026-09-07T04:55:00.000Z");
      const afterChicagoMidnight = new Date("2026-09-07T05:05:00.000Z");
      const a = hashEngineInput("deterministic", {
        asOfDate: beforeChicagoMidnight,
      });
      const b = hashEngineInput("deterministic", {
        asOfDate: afterChicagoMidnight,
      });
      expect(a).not.toBe(b);
    });
  });
});
