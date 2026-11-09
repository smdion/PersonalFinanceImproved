/**
 * Answer key, prior-year IRA and HSA room before the deadline (LIM-15;
 * v0.10.5 overnight batch). Worked by hand from the statute first, never
 * read from `src/`; the shipped 2025 limits are only the input. Invented
 * people only.
 *
 * Citations: IRC 219(f)(3) and 408A(c)(7) (an IRA contribution made by
 * the return's due date, without extensions, counts for the prior year);
 * 223(d)(4)(C) (the same for an HSA); 219(b)(5)(B) (IRA catch-up for
 * someone 50 by the end of the year the contribution counts for);
 * 223(b)(3) (HSA catch-up at 55 by that year's end); 402(g)(1) (401(k)
 * deferrals come from that year's pay: no prior-year contribution). 2025
 * figures: IRA $7,000, catch-up $1,000 (Notice 2024-80); HSA self-only
 * $4,300, family $8,550, catch-up $1,000 (Rev. Proc. 2024-25). `age` is
 * the age at the end of the current year (2026), so the prior year's is
 * one less.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { readTaxData } from "../../helpers/tax-data";
import {
  isEligibleForPriorYear,
  resolvePriorYearLimit,
} from "@/lib/pure/contributions/irs-limits";

const limits2025: Record<string, number> = Object.fromEntries(
  Object.entries(readTaxData().years["2025"]!.limits).map(([k, v]) => [
    k,
    v.value,
  ]),
);

describe("answer key: prior-year room", () => {
  it("limits/LIM15-1 [LIM-15] IRA: the catch-up turns on the prior year's age", () => {
    // Born 1976: 50 in 2026, 49 at the end of 2025: 7,000. Born 1975: 50
    // at the end of 2025: 7,000 + 1,000 = 8,000.
    cents(
      {
        at49: resolvePriorYearLimit("ira", 50, null, limits2025),
        at50: resolvePriorYearLimit("ira", 51, null, limits2025),
      },
      { at49: 7_000, at50: 8_000 },
    );
  });

  it("limits/LIM15-2 [LIM-15] HSA: coverage picks the limit, 55 adds the catch-up", () => {
    // Self-only, 40 in 2025: 4,300. Family, born 1970 (55 at the end of
    // 2025): 8,550 + 1,000 = 9,550.
    cents(
      {
        selfOnly: resolvePriorYearLimit("hsa", 41, "self_only", limits2025),
        family55: resolvePriorYearLimit("hsa", 56, "family", limits2025),
      },
      { selfOnly: 4_300, family55: 9_550 },
    );
  });

  it("limits/LIM15-3 [LIM-15] a 401(k) has no prior-year room", () => {
    cents(resolvePriorYearLimit("401k", 45, null, limits2025), 0);
  });

  it("limits/LIM15-4 [LIM-15] a prior-year amount counts only inside the window, for an IRA or HSA", () => {
    // Inside the window (to the April due date), $1,000 to an IRA or an
    // HSA: yes. After it: no. A 401(k): never. Nothing entered: no.
    expect([
      isEligibleForPriorYear(true, "ira", 1_000),
      isEligibleForPriorYear(true, "hsa", 1_000),
      isEligibleForPriorYear(false, "ira", 1_000),
      isEligibleForPriorYear(true, "401k", 1_000),
      isEligibleForPriorYear(true, "ira", 0),
    ]).toEqual([true, true, false, false, false]);
  });
});
