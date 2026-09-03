/**
 * Full-pipeline integration test for tracked Roth basis draw-down.
 *
 * Acceptance criteria exercised here:
 *   6. Basis-exhaustion transition: a household whose tracked basis runs to
 *      zero mid-decumulation flips `eligibilityLocked` from false to true in
 *      a specific year, and stays true afterward.
 *   7. Conservation: for every year, rothBasisDrawn + growth-portion of the
 *      withdrawal never exceeds the actual withdrawal, and basisRemaining
 *      never goes negative.
 *
 * The owner's birth year is chosen so they stay under 59½ for the entire
 * projection window, isolating the flip to basis exhaustion rather than the
 * age-threshold gate (which would also unlock the account on its own).
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.25,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
      taxSplits: { "401k": 0.5, ira: 1.0 },
    },
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "percentage",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        brokerage: 0.3,
        hsa: 0.1,
      },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 45,
    retirementAge: 50,
    projectionEndAge: 58,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 100000,
      taxFree: 30000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 15000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 80000,
        roth: 0,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 150000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  };
}

describe("Tracked Roth basis draw-down — full pipeline", () => {
  it("flips eligibilityLocked from false to true once tracked basis is exhausted, and it stays locked", () => {
    // Owner born 1980: at retirement (age 50, year 2030) through end of
    // projection (age 58, year 2038) they never cross 59½ — any
    // eligibility change we observe must come from basis exhaustion, not
    // the age gate.
    const input = makeInput({
      individualAccounts: [
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 150000,
          ownerName: "Alice",
          ownerPersonId: 1,
          ownerBirthYear: 1980,
          parentCategory: "Retirement",
          rothBasisMeta: {
            year: 2025,
            contributionBasis: 10000,
            conversionBasis: 0,
            latestConversionYear: null,
            isSeeded: false,
            updatedAt: new Date("2025-01-01"),
          },
        },
      ],
    });

    const result = calculateProjection(input);

    const iraYears = result.projectionByYear
      .map((yr) => {
        const acct = yr.individualAccountBalances.find(
          (a) => a.name === "Roth IRA",
        );
        return acct
          ? {
              year: yr.year,
              locked: acct.eligibilityLocked,
              basisRemaining: acct.rothBasisRemaining,
              basisDrawn: acct.rothBasisDrawn,
              withdrawal: acct.withdrawal ?? 0,
              balance: acct.balance,
            }
          : null;
      })
      .filter((y): y is NonNullable<typeof y> => y !== null);

    // Sanity: the account is actually drawn down over the decumulation
    // years (otherwise this fixture proves nothing).
    const decumYears = iraYears.filter((y) => y.withdrawal > 0);
    expect(decumYears.length).toBeGreaterThan(0);

    // Basis never goes negative.
    for (const y of iraYears) {
      if (y.basisRemaining !== undefined) {
        expect(y.basisRemaining).toBeGreaterThanOrEqual(0);
      }
    }

    // Find the first year locked flips true, and confirm it corresponds to
    // basis hitting zero (not before), and that it never flips back false.
    const firstLockedIdx = iraYears.findIndex((y) => y.locked === true);
    expect(firstLockedIdx).toBeGreaterThan(-1);

    const firstLockedYear = iraYears[firstLockedIdx];
    expect(firstLockedYear.basisRemaining).toBe(0);

    // Every year before the flip (once withdrawals have started) had
    // basisRemaining > 0 while unlocked.
    for (let i = 0; i < firstLockedIdx; i++) {
      const y = iraYears[i];
      if (y.withdrawal > 0 && y.locked !== undefined) {
        expect(y.locked).toBe(false);
      }
    }

    // Once locked, it stays locked for the rest of the projection (basis
    // never replenishes without new contributions, and this fixture makes
    // none post-retirement).
    for (let i = firstLockedIdx; i < iraYears.length; i++) {
      if (iraYears[i].withdrawal > 0 || iraYears[i].balance > 0) {
        expect(iraYears[i].locked).toBe(true);
      }
    }
  });

  it("conservation: rothBasisDrawn never exceeds that year's withdrawal, and basis book-keeping is monotonically non-increasing absent new contributions", () => {
    const input = makeInput({
      individualAccounts: [
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 150000,
          ownerName: "Alice",
          ownerPersonId: 1,
          ownerBirthYear: 1980,
          parentCategory: "Retirement",
          rothBasisMeta: {
            year: 2025,
            contributionBasis: 10000,
            conversionBasis: 0,
            latestConversionYear: null,
            isSeeded: false,
            updatedAt: new Date("2025-01-01"),
          },
        },
      ],
    });

    const result = calculateProjection(input);

    let prevBasisRemaining: number | undefined;
    for (const yr of result.projectionByYear) {
      const acct = yr.individualAccountBalances.find(
        (a) => a.name === "Roth IRA",
      );
      if (!acct) continue;

      if (acct.rothBasisDrawn !== undefined) {
        expect(acct.rothBasisDrawn).toBeLessThanOrEqual(
          (acct.withdrawal ?? 0) + 0.01,
        );
        expect(acct.rothBasisDrawn).toBeGreaterThanOrEqual(0);
      }

      // Basis remaining never increases year-over-year (no new
      // contributions to this account post-retirement in this fixture).
      if (
        prevBasisRemaining !== undefined &&
        acct.rothBasisRemaining !== undefined
      ) {
        expect(acct.rothBasisRemaining).toBeLessThanOrEqual(
          prevBasisRemaining + 0.01,
        );
      }
      prevBasisRemaining = acct.rothBasisRemaining;
    }
  });
});
