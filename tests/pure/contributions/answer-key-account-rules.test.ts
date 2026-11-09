/**
 * Answer key, limits (v0.10.5 overnight batch): the account-type rules
 * the caps read (LIM-28) and a slot's room for employee money (LIM-27).
 * Each expected value is read from the statute first, never from
 * `src/`. Invented figures only.
 *
 * Citations: IRC 402(g)(1) (one elective-deferral limit across a
 * person's 401(k) and 403(b) plans, 402(g)(3)), 414(v)(2)(B)(i), (v)(5)
 * (catch-up from the year a participant turns 50) and 414(v)(2)(E) (the
 * larger catch-up for ages 60-63, SECURE 2.0 § 109); 408(a)(1), 219(b)
 * (1), (5)(B) and 408A(c)(2) (one IRA limit across Traditional and Roth,
 * no more than compensation, catch-up at 50); 223(b)(3) (HSA catch-up at
 * 55), 223(b)(4)(B) (employer money reduces the HSA limit), 223(b)(5)
 * (married with family coverage: one limit split between the spouses);
 * 3121(a)(5)(G) and 125 (HSA money through a cafeteria plan isn't FICA
 * wages), 3121(v)(1)(A) (401(k) and 403(b) deferrals are FICA wages);
 * 415(c)(1) (employer match counts toward the annual-additions limit, not
 * 402(g)). 2026 figures: 402(g) $24,500 (Notice 2025-67), HSA family
 * $8,750 (Rev. Proc. 2025-19).
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  getAccountTypeConfig,
  getLimitGroup,
} from "@/lib/config/account-types";
import { remainingRoom } from "@/lib/pure/engine/contribution-routing";

const cfg = getAccountTypeConfig;

describe("answer key: account-type rules from the statute", () => {
  it("limits/LIM28-1 [LIM-28] one deferral limit for 401(k) and 403(b), one IRA limit, the HSA its own", () => {
    // 402(g)(1), (3): a person's deferrals to every plan share $24,500.
    // 408(a)(1), 408A(c)(2): Traditional and Roth IRAs share one limit.
    // 223(b): the HSA's own. A taxable brokerage has none.
    expect(getLimitGroup("401k")).toBe(getLimitGroup("403b"));
    expect(
      new Set([
        getLimitGroup("401k"),
        getLimitGroup("ira"),
        getLimitGroup("hsa"),
      ]).size,
    ).toBe(3);
    expect(cfg("brokerage").hasIrsLimit).toBe(false);
  });

  it("limits/LIM28-2 [LIM-28] employer money counts toward the HSA limit, not the 401(k) deferral limit", () => {
    // 223(b)(4)(B): employer HSA contributions reduce the limit. 402(g)
    // caps elective deferrals only; the match is a 415(c) annual addition.
    expect({
      hsa: cfg("hsa").matchCountsTowardLimit,
      k401: cfg("401k").matchCountsTowardLimit,
      b403: cfg("403b").matchCountsTowardLimit,
    }).toEqual({ hsa: true, k401: false, b403: false });
  });

  it("limits/LIM28-3 [LIM-28] payroll HSA money is FICA-exempt, 401(k) and 403(b) deferrals aren't", () => {
    // 3121(a)(5)(G) with 125: HSA through a cafeteria plan is not FICA
    // wages. 3121(v)(1)(A): elective deferrals stay FICA wages.
    expect({
      hsa: cfg("hsa").payrollFicaExempt,
      k401: cfg("401k").payrollFicaExempt,
      b403: cfg("403b").payrollFicaExempt,
      ira: cfg("ira").payrollFicaExempt,
    }).toEqual({ hsa: true, k401: false, b403: false, ira: false });
  });

  it("limits/LIM28-4 [LIM-28] catch-up ages: 50 for plans and IRAs, 55 for an HSA, 60-63 the larger one", () => {
    // 414(v)(5), 219(b)(5)(B): 50. 223(b)(3): 55. 414(v)(2)(E): 60 to 63
    // for plans; IRAs and HSAs have no larger tier.
    expect({
      k401: cfg("401k").catchupAge,
      b403: cfg("403b").catchupAge,
      ira: cfg("ira").catchupAge,
      hsa: cfg("hsa").catchupAge,
      k401Super: cfg("401k").superCatchupAgeRange,
      iraSuper: cfg("ira").superCatchupAgeRange,
      hsaSuper: cfg("hsa").superCatchupAgeRange,
    }).toEqual({
      k401: 50,
      b403: 50,
      ira: 50,
      hsa: 55,
      k401Super: [60, 63],
      iraSuper: null,
      hsaSuper: null,
    });
  });

  it("limits/LIM28-5 [LIM-28] the IRA is bounded by pay; the HSA limit can be shared by a couple", () => {
    // 219(b)(1)(B): no more than compensation (408A(c)(2) for Roth).
    // 223(b)(5): spouses with family coverage share one limit.
    expect({
      iraPay: cfg("ira").limitBoundedByCompensation,
      hsaHousehold: cfg("hsa").isHouseholdLimit,
      k401Household: cfg("401k").isHouseholdLimit,
      iraHousehold: cfg("ira").isHouseholdLimit,
    }).toEqual({
      iraPay: true,
      hsaHousehold: true,
      k401Household: false,
      iraHousehold: false,
    });
  });
});

describe("answer key: a slot's room for employee money", () => {
  it("limits/LIM27-1 [LIM-27] 401(k): the match leaves the deferral room alone", () => {
    // 402(g) 24,500, employee 10,000 so far, match 5,000 (not a deferral):
    // room 24,500 − 10,000 = 14,500.
    cents(
      remainingRoom(
        {
          category: "401k",
          irsLimit: 24_500,
          effectiveLimit: 24_500,
          employerMatch: 5_000,
        },
        10_000,
      ),
      14_500,
    );
  });

  it("limits/LIM27-2 [LIM-27] HSA: employer money comes off the limit first", () => {
    // Family 8,750, employer 1,000 (223(b)(4)(B)), employee 3,000 so far:
    // room 8,750 − 1,000 − 3,000 = 4,750.
    cents(
      remainingRoom(
        {
          category: "hsa",
          irsLimit: 8_750,
          effectiveLimit: 8_750,
          employerMatch: 1_000,
        },
        3_000,
      ),
      4_750,
    );
  });

  it("limits/LIM27-3 [LIM-27] never below zero, and none for the taxable brokerage", () => {
    // HSA employer 8,000, employee 1,000: 8,750 − 9,000 < 0, room 0. A
    // brokerage has no limit and takes overflow: no room is reported.
    cents(
      {
        over: remainingRoom(
          {
            category: "hsa",
            irsLimit: 8_750,
            effectiveLimit: 8_750,
            employerMatch: 8_000,
          },
          1_000,
        ),
        brokerage: remainingRoom(
          {
            category: "brokerage",
            irsLimit: Infinity,
            effectiveLimit: Infinity,
            employerMatch: 0,
          },
          0,
        ),
      },
      { over: 0, brokerage: 0 },
    );
  });
});
