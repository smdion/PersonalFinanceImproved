import { describe, it, expect } from "vitest";
import { enforceRmd } from "@/lib/calculators/engine/rmd-enforcement";
import type { RmdEnforcementInput } from "@/lib/calculators/engine/rmd-enforcement";
import type { DecumulationSlot } from "@/lib/calculators/types";
import { makeAccountBalances } from "./fixtures/engine-fixtures";
import { getAllCategories } from "@/lib/config/account-types";

function zeroByCat() {
  return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
    ReturnType<typeof getAllCategories>[number],
    number
  >;
}

function baseInput(
  overrides: Partial<RmdEnforcementInput> = {},
): RmdEnforcementInput {
  return {
    age: 75,
    rmdStartAge: 73,
    priorYearEndTradBalance: 100000,
    slots: [] as DecumulationSlot[],
    totalTraditionalWithdrawal: 0,
    totalWithdrawal: 0,
    acctBal: makeAccountBalances({ preTax: 500000, afterTax: 0 }),
    ...overrides,
  };
}

describe("enforceRmd", () => {
  it("rmdShortfallAmount is 0 when the RMD is fully forced through", () => {
    const acctBal = makeAccountBalances({ preTax: 0, afterTax: 0 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 100000,
      roth: 0,
    };
    const result = enforceRmd(
      baseInput({ overrideRmdRequired: 5000, acctBal }),
    );
    expect(result.rmdAmount).toBe(5000);
    expect(result.totalTraditionalWithdrawal).toBe(5000);
    expect(result.rmdShortfallAmount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("rmdShortfallAmount is 0 when nothing is owed (no override, age under RMD start)", () => {
    const result = enforceRmd(baseInput({ age: 60, rmdStartAge: 73 }));
    expect(result.rmdAmount).toBe(0);
    expect(result.rmdShortfallAmount).toBe(0);
  });

  // -------------------------------------------------------------------
  // R49: nonRetirement capacity scoping + rmdShortfallAmount
  // -------------------------------------------------------------------

  it("caps the shortfall's distribution capacity to Retirement-only balance, leaving a real rmdShortfallAmount when that's insufficient", () => {
    const acctBal = makeAccountBalances({ preTax: 0, afterTax: 0 });
    // $100k blended 401k balance, but $80k of it is Portfolio-parented --
    // only $20k is actually available to satisfy a forced RMD shortfall.
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 100000,
      roth: 0,
    };
    const nonRetirement = {
      total: zeroByCat(),
      trad: { ...zeroByCat(), "401k": 80000 },
      roth: zeroByCat(),
      grandTotal: 80000,
    };
    const result = enforceRmd(
      baseInput({ overrideRmdRequired: 30000, acctBal, nonRetirement }),
    );
    expect(result.rmdAmount).toBe(30000); // requirement itself unaffected
    expect(result.totalTraditionalWithdrawal).toBe(20000); // capped to Retirement-only capacity
    expect(result.rmdShortfallAmount).toBe(10000); // 30000 - 20000
    expect(result.warnings[0]).toContain("RMD SHORTFALL");
  });

  it("the RMD REQUIREMENT itself stays computed off the full blended balance, not scoped by nonRetirement", () => {
    // priorYearEndTradBalance is the blended (Retirement + Portfolio)
    // total upstream of this module -- nonRetirement must not touch the
    // requirement, only the shortfall's distribution capacity below it.
    const acctBal = makeAccountBalances({ preTax: 0, afterTax: 0 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 500000,
      roth: 0,
    };
    const nonRetirement = {
      total: zeroByCat(),
      trad: { ...zeroByCat(), "401k": 400000 },
      roth: zeroByCat(),
      grandTotal: 400000,
    };
    const factorInput = baseInput({
      age: 75,
      rmdStartAge: 73,
      priorYearEndTradBalance: 500000, // blended total
      acctBal,
      nonRetirement,
    });
    const result = enforceRmd(factorInput);
    // rmdAmount is derived from the full 500000, not the 100000
    // Retirement-only remainder -- assert it's the larger, requirement-
    // correct figure (real IRS factor math, not re-derived here, just
    // confirmed it didn't shrink to the Retirement-only balance).
    expect(result.rmdAmount).toBeGreaterThan(15000); // any RMD factor on 500k clears this
    expect(result.rmdAmount).not.toBeCloseTo(100000 / 24.6, 1); // not silently recomputed off 100k
  });

  it("no drift when nonRetirement is undefined or all-zero (byte-identical to pre-R49 behavior)", () => {
    const acctBal = makeAccountBalances({ preTax: 0, afterTax: 0 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 100000,
      roth: 0,
    };
    const withoutArg = enforceRmd(
      baseInput({ overrideRmdRequired: 30000, acctBal: { ...acctBal } }),
    );
    const withZeroExclusion = enforceRmd(
      baseInput({
        overrideRmdRequired: 30000,
        acctBal: { ...acctBal },
        nonRetirement: {
          total: zeroByCat(),
          trad: zeroByCat(),
          roth: zeroByCat(),
          grandTotal: 0,
        },
      }),
    );
    expect(withoutArg.totalTraditionalWithdrawal).toBe(
      withZeroExclusion.totalTraditionalWithdrawal,
    );
    expect(withoutArg.rmdShortfallAmount).toBe(
      withZeroExclusion.rmdShortfallAmount,
    );
  });

  it("distributes a shortfall across multiple Retirement-only categories proportionally, excluding each category's own Portfolio-parented share", () => {
    const acctBal = makeAccountBalances({ preTax: 0, afterTax: 0 });
    acctBal["401k"] = {
      structure: "roth_traditional",
      traditional: 60000,
      roth: 0,
    };
    acctBal.ira = {
      structure: "roth_traditional",
      traditional: 40000,
      roth: 0,
    };
    // 401k: half Portfolio-parented (30000 excluded, 30000 Retirement-only).
    // ira: fully Retirement-only.
    const nonRetirement = {
      total: zeroByCat(),
      trad: { ...zeroByCat(), "401k": 30000 },
      roth: zeroByCat(),
      grandTotal: 30000,
    };
    const result = enforceRmd(
      baseInput({ overrideRmdRequired: 50000, acctBal, nonRetirement }),
    );
    // Retirement-only capacity: 401k 30000 + ira 40000 = 70000, well over
    // the 50000 shortfall -- fully satisfiable, no rmdShortfallAmount.
    expect(result.totalTraditionalWithdrawal).toBe(50000);
    expect(result.rmdShortfallAmount).toBe(0);
  });
});
