/**
 * The bracket target is a preference for the order money comes out in, not a
 * limit on spending: next account first, then past the target with a
 * warning. The household's own caps stay hard, across every pass.
 */
import { describe, expect, it } from "vitest";
import { routeForMode } from "@/lib/pure/engine/withdrawal-routing";
import { routeWithdrawalsPercentage } from "@/lib/pure/engine/withdrawal-routing/percentage";
import { deriveBasisRankingInputs } from "@/lib/pure/engine/withdrawal-cost-ranking";
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import {
  makeAccountBalances,
  makeDecumulationConfig,
  TEST_BRACKETS,
} from "../fixtures/engine-fixtures";
import { shippedTaxTables } from "../../helpers/tax-data";

const LTCG = shippedTaxTables().ltcgBrackets;
/** Only the money named: the fixture's defaults fill every bucket. */
const only = (over: Partial<Parameters<typeof makeAccountBalances>[0]>) =>
  makeAccountBalances({
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
    ...over,
  });
const bracketInfo = {
  taxBrackets: TEST_BRACKETS,
  rothBracketTarget: 0.12,
  taxableSS: 0,
  ltcgBrackets: LTCG,
  filingStatus: "MFJ" as const,
};
const drawn = (r: { slots: { withdrawal: number }[] }) =>
  r.slots.reduce((t, s) => t + s.withdrawal, 0);
const noCaps = {
  "401k": null,
  "403b": null,
  ira: null,
  hsa: null,
  brokerage: null,
};

describe("waterfall with a bracket target", () => {
  const waterfall = (over = {}) =>
    makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
      ...over,
    });

  it("only Traditional money: funds the need past the target, and says so", () => {
    const r = routeForMode(
      200000,
      waterfall(),
      only({ preTax: 500000 }),
      bracketInfo,
    );
    expect(drawn(r)).toBeCloseTo(200000, 0);
    expect(r.unmetNeed).toBeUndefined();
    expect(r.warnings.join()).toMatch(/went past your bracket target/);
    expect(r.warnings.join()).not.toMatch(/unmet/);
  });

  it("the next account goes first: no warning while it covers the need", () => {
    const r = routeForMode(
      120000,
      waterfall(),
      only({
        preTax: 500000,
        afterTax: 900000,
        afterTaxBasis: 900000,
      }),
      bracketInfo,
    );
    expect(drawn(r)).toBeCloseTo(120000, 0);
    expect(
      r.slots.find((s) => s.category === "brokerage")!.withdrawal,
    ).toBeGreaterThan(0);
    expect(r.warnings.join()).not.toMatch(/bracket target/);
  });

  it("the household's own Traditional cap still holds", () => {
    const r = routeForMode(
      200000,
      waterfall({
        withdrawalTaxTypeCaps: { traditional: 150000, roth: null },
      }),
      only({ preTax: 500000 }),
      bracketInfo,
    );
    expect(drawn(r)).toBeCloseTo(150000, 0);
    expect(r.unmetNeed).toBeCloseTo(50000, 0);
  });
});

describe("bracket filling past the target", () => {
  it("funds the need and warns", () => {
    const r = routeForMode(
      200000,
      makeDecumulationConfig({ withdrawalRoutingMode: "bracket_filling" }),
      only({ preTax: 500000 }),
      bracketInfo,
    );
    expect(drawn(r)).toBeCloseTo(200000, 0);
    expect(r.warnings.join()).toMatch(/went past your bracket target/);
  });
});

describe("percentage mode with a tax-type cap", () => {
  const config = (over = {}) =>
    makeDecumulationConfig({
      withdrawalRoutingMode: "percentage",
      withdrawalSplits: { "401k": 1, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      withdrawalTaxTypeCaps: { traditional: 10000, roth: null },
      ...over,
    });

  it("a capped draw moves to the next account, not lost", () => {
    const r = routeWithdrawalsPercentage(
      50000,
      config(),
      only({
        preTax: 400000,
        afterTax: 500000,
        afterTaxBasis: 500000,
      }),
    );
    expect(drawn(r)).toBeCloseTo(50000, 0);
    expect(r.unmetNeed).toBeUndefined();
  });

  it("with nowhere to go it's an unmet need, with a warning", () => {
    const r = routeWithdrawalsPercentage(
      50000,
      config(),
      only({ preTax: 400000 }),
    );
    expect(drawn(r)).toBeCloseTo(10000, 0);
    expect(r.unmetNeed).toBeCloseTo(40000, 0);
    expect(r.warnings.join()).toMatch(/unmet/);
  });
});

describe("the last-resort pass and the household's caps", () => {
  const exposure = (locked: number) =>
    ({
      penaltyExposedTrad: { ira: locked },
      penaltyExposedRoth: {},
      penaltyExposedTotal: { ira: locked },
      totalPenaltyExposed: locked,
      penaltyExposedTradStillExcluded: {},
      penaltyExposedRothStillExcluded: {},
      penaltyExposedTotalStillExcluded: {},
      totalPenaltyExposedStillExcluded: 0,
      reachableByCategory: {},
    }) as unknown as EligibilityRecord; // eslint-disable-line no-restricted-syntax -- only the fields routing reads

  it("an account cap covers both passes", () => {
    const r = routeForMode(
      50000,
      makeDecumulationConfig({
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["ira"],
        avoidPenalizedWithdrawals: true,
        withdrawalAccountCaps: { ...noCaps, ira: 30000 },
      }),
      only({ preTax: 100000 }),
      { ...bracketInfo, rothBracketTarget: undefined },
      exposure(60000),
    );
    expect(
      r.slots.find((s) => s.category === "ira")!.withdrawal,
    ).toBeLessThanOrEqual(30000);
  });
});

describe("Roth growth past 59½ ranks as free", () => {
  const account = (ownerBirthYear: number) => ({
    name: "Roth",
    category: "ira",
    taxType: "taxFree",
    parentCategory: "Retirement",
    ownerBirthYear,
  });
  const run = (ownerBirthYear: number, year: number) =>
    deriveBasisRankingInputs({
      balances:
        only({ taxFree: 800000 }).constructor === Object
          ? ({
              preTax: 0,
              taxFree: 800000,
              hsa: 0,
              afterTax: 0,
              afterTaxBasis: 0,
            } as never)
          : ({} as never),
      indBasis: new Map(),
      indAccts: [account(ownerBirthYear)],
      indKey: () => "roth",
      indBal: new Map([["roth", 800000]]),
      year,
    }).rothBasisAvailable;

  it("a qualified owner's whole balance is free capacity, basis or no basis", () => {
    expect(run(1960, 2026)).toBe(800000);
  });
  it("under 59½ only recorded basis is", () => {
    expect(run(1990, 2026)).toBe(0);
  });
});
