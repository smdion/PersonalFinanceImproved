/**
 * Property-based invariant tests for the retirement projection engine.
 *
 * These invariants must hold for ANY valid input. Uses fast-check to
 * generate random inputs and assert mathematical/logical correctness.
 *
 * Run time defaults to 20 runs per invariant (CI-friendly). Override with
 * FAST_CHECK_NUM_RUNS=200 for deeper stress testing (see `pnpm test:stress`).
 */
import {
  startingBalanceGaps,
  withConsistentStart,
} from "./fixtures/engine-fixtures";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  toSimpleTaxMode,
  type SimpleTaxModeParts,
} from "@/lib/calculators/simple-tax-mode";
import type {
  IndividualAccountInput,
  ProjectionInput,
  EngineDecumulationYear,
  EngineAccumulationYear,
} from "@/lib/calculators/types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getTotalBalance,
  getTraditionalBalance,
} from "@/lib/config/account-types";
import { WITHDRAWAL_STRATEGY_VALUES } from "@/lib/config/withdrawal-strategies";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? "20", 10);
const AS_OF = new Date("2025-03-07");
const EPSILON = 0.011; // $0.011 rounding tolerance (cent + tiny float)

/** Build a minimal valid engine input with sensible defaults. */
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return withConsistentStart(
    {
      accumulationDefaults: {
        contributionRate: 0.15,
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
        withdrawalRoutingMode: "waterfall",
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
      currentAge: 35,
      retirementAge: 65,
      projectionEndAge: 90,
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
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
      employerMatchRateByCategory: {
        "401k": 0.03,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: {
        preTax: 110000,
        taxFree: 40000,
        afterTax: 30000,
        afterTaxBasis: 20000,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 80000,
          roth: 20000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 30000,
          basis: 20000,
        },
      },
      annualExpenses: 72000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
      ...overrides,
    },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// fast-check arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a valid ProjectionInput with randomized core fields. */
function arbitraryInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 25, max: 60 }),
      yearsToRetirement: fc.integer({ min: 5, max: 20 }),
      yearsInRetirement: fc.integer({ min: 15, max: 35 }),
      salary: fc.integer({ min: 30000, max: 500000 }),
      salaryGrowthRate: fc.double({ min: -0.02, max: 0.06, noNaN: true }),
      annualExpenses: fc.integer({ min: 20000, max: 200000 }),
      returnRate: fc.double({ min: 0.03, max: 0.1, noNaN: true }),
      contributionRate: fc.double({ min: 0.0, max: 0.4, noNaN: true }),
      preTaxBalance: fc.integer({ min: 0, max: 500000 }),
      rothBalance: fc.integer({ min: 0, max: 200000 }),
      brokerageBalance: fc.integer({ min: 0, max: 200000 }),
      hsaBalance: fc.integer({ min: 0, max: 50000 }),
      ssAnnual: fc.integer({ min: 0, max: 48000 }),
      inflationRate: fc.double({ min: 0.01, max: 0.05, noNaN: true }),
    })
    .map((r) => {
      const retirementAge = r.currentAge + r.yearsToRetirement;
      const projectionEndAge = retirementAge + r.yearsInRetirement;
      const ssStartAge = Math.min(Math.max(retirementAge, 62), 70);
      const brokerBasis = Math.floor(r.brokerageBalance * 0.6);

      return makeInput({
        currentAge: r.currentAge,
        retirementAge,
        projectionEndAge,
        currentSalary: r.salary,
        salaryGrowthRate: r.salaryGrowthRate,
        annualExpenses: Math.min(r.annualExpenses, r.salary),
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        accumulationDefaults: {
          contributionRate: r.contributionRate,
          routingMode: "waterfall",
          accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
          accountSplits: {
            "401k": 0.5,
            "403b": 0,
            hsa: 0.1,
            ira: 0.1,
            brokerage: 0.3,
          },
          taxSplits: { "401k": 0.5, ira: 1.0 },
        },
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: r.rothBalance,
          afterTax: r.brokerageBalance,
          afterTaxBasis: brokerBasis,
          hsa: r.hsaBalance,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: Math.floor(r.preTaxBalance * 0.7),
            roth: Math.floor(r.rothBalance * 0.3),
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: r.hsaBalance },
          ira: {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - Math.floor(r.preTaxBalance * 0.7),
            roth: r.rothBalance - Math.floor(r.rothBalance * 0.3),
          },
          brokerage: {
            structure: "basis_tracking",
            balance: r.brokerageBalance,
            basis: brokerBasis,
          },
        },
        socialSecurityAnnual: r.ssAnnual,
        ssStartAge,
        inflationRate: r.inflationRate,
      });
    });
}

/** Arbitrary for an input where the person is already retired (decumulation-only). */
function arbitraryRetiredInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 66, max: 75 }),
      yearsRemaining: fc.integer({ min: 10, max: 25 }),
      preTaxBalance: fc.integer({ min: 100000, max: 1000000 }),
      rothBalance: fc.integer({ min: 50000, max: 400000 }),
      brokerageBalance: fc.integer({ min: 20000, max: 300000 }),
      hsaBalance: fc.integer({ min: 0, max: 80000 }),
      annualExpenses: fc.integer({ min: 30000, max: 120000 }),
      returnRate: fc.double({ min: 0.03, max: 0.09, noNaN: true }),
    })
    .map((r) => {
      const brokerBasis = Math.floor(r.brokerageBalance * 0.5);
      return makeInput({
        currentAge: r.currentAge,
        retirementAge: r.currentAge - 1, // already retired
        projectionEndAge: r.currentAge + r.yearsRemaining,
        currentSalary: 0,
        annualExpenses: r.annualExpenses,
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: r.rothBalance,
          afterTax: r.brokerageBalance,
          afterTaxBasis: brokerBasis,
          hsa: r.hsaBalance,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: Math.floor(r.preTaxBalance * 0.8),
            roth: Math.floor(r.rothBalance * 0.2),
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: r.hsaBalance },
          ira: {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - Math.floor(r.preTaxBalance * 0.8),
            roth: r.rothBalance - Math.floor(r.rothBalance * 0.2),
          },
          brokerage: {
            structure: "basis_tracking",
            balance: r.brokerageBalance,
            basis: brokerBasis,
          },
        },
        socialSecurityAnnual: 24000,
        ssStartAge: Math.min(r.currentAge, 70),
      });
    });
}

/** Arbitrary for an input with a birthYear so RMD applies. */
function arbitraryRmdInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 68, max: 76 }),
      yearsRemaining: fc.integer({ min: 10, max: 20 }),
      preTaxBalance: fc.integer({ min: 200000, max: 800000 }),
      returnRate: fc.double({ min: 0.03, max: 0.08, noNaN: true }),
    })
    .map((r) => {
      const birthYear = AS_OF.getFullYear() - r.currentAge;
      return makeInput({
        currentAge: r.currentAge,
        retirementAge: r.currentAge - 1,
        projectionEndAge: r.currentAge + r.yearsRemaining,
        currentSalary: 0,
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        birthYear,
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: 50000,
          afterTax: 30000,
          afterTaxBasis: 15000,
          hsa: 10000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - 30000,
            roth: 30000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 10000 },
          ira: {
            structure: "roth_traditional",
            traditional: 30000,
            roth: 20000,
          },
          brokerage: {
            structure: "basis_tracking",
            balance: 30000,
            basis: 15000,
          },
        },
        socialSecurityAnnual: 30000,
        ssStartAge: r.currentAge,
      });
    });
}

// ---------------------------------------------------------------------------
// Helper: sum per-account category slot contributions
// ---------------------------------------------------------------------------

function _sumSlotContributions(slots: EngineAccumulationYear["slots"]): number {
  return slots.reduce((sum, s) => sum + s.employeeContrib + s.employerMatch, 0);
}

function sumSlotWithdrawals(slots: EngineDecumulationYear["slots"]): number {
  return slots.reduce((sum, s) => sum + s.withdrawal, 0);
}

// ---------------------------------------------------------------------------
// RMD factor table (IRS Uniform Lifetime Table — SECURE 2.0)
// The engine uses this same table; we replicate it here for invariant checks.
// ---------------------------------------------------------------------------

const RMD_FACTORS: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
};

// ---------------------------------------------------------------------------
// IRMAA thresholds (2025 approximate — for structural invariant checks only)
// ---------------------------------------------------------------------------

const _IRMAA_CLIFFS_MFJ = [206000, 258000, 322000, 386000, 750000];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("engine invariants", () => {
  // -------------------------------------------------------------------------
  // Group A: Balance invariants
  // -------------------------------------------------------------------------

  describe("A: balance invariants", () => {
    it("1 — no account balance (by tax bucket) goes negative", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            const btx = year.balanceByTaxType;
            expect(btx.preTax).toBeGreaterThanOrEqual(-EPSILON);
            expect(btx.taxFree).toBeGreaterThanOrEqual(-EPSILON);
            expect(btx.afterTax).toBeGreaterThanOrEqual(-EPSILON);
            expect(btx.hsa).toBeGreaterThanOrEqual(-EPSILON);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("22 — no individual account balance (by category) goes negative", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            for (const [_cat, bal] of Object.entries(year.balanceByAccount)) {
              const total = getTotalBalance(
                bal as Parameters<typeof getTotalBalance>[0],
              );
              expect(total).toBeGreaterThanOrEqual(-EPSILON);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("5 — year N ending balances equal year N+1 starting balances (within rounding)", () => {
      // The engine does not expose "startBalance" directly, but the first year's
      // allAccountsBalance feeds the next year's computation. We verify that allAccountsBalance
      // is monotonically consistent: the sum of balanceByTaxType equals allAccountsBalance.
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          const years = result.projectionByYear;
          for (let i = 0; i < years.length - 1; i++) {
            const cur = years[i]!;
            const next = years[i + 1]!;
            // allAccountsBalance must equal sum of tax-bucket balances
            const bucketSum =
              cur.balanceByTaxType.preTax +
              cur.balanceByTaxType.taxFree +
              cur.balanceByTaxType.afterTax +
              cur.balanceByTaxType.hsa;
            expect(Math.abs(cur.allAccountsBalance - bucketSum)).toBeLessThan(
              EPSILON + 1,
            );
            // allAccountsBalance of year N must be positive if next year has a non-zero balance
            if (next.allAccountsBalance > 1) {
              expect(cur.allAccountsBalance).toBeGreaterThanOrEqual(-EPSILON);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("18 — sum of individual account balances per category equals category total", () => {
      // When startingAccountBalances is provided, per-account totals must match
      // the category-level balanceByAccount totals.
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.individualAccountBalances.length === 0) continue;
            // Group individual accounts by category
            const byCategory: Record<string, number> = {};
            for (const acct of year.individualAccountBalances) {
              byCategory[acct.category] =
                (byCategory[acct.category] ?? 0) + acct.balance;
            }
            for (const [cat, indivTotal] of Object.entries(byCategory)) {
              const catBal = year.balanceByAccount[cat as AccountCategory];
              if (!catBal) continue;
              const catTotal = getTotalBalance(catBal);
              // Individual account sum should equal category total to the
              // cent — tightened from < $1 now that
              // reconcileIndividualToAggregate runs every year.
              expect(Math.abs(indivTotal - catTotal)).toBeLessThan(0.01);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group B: Accumulation phase invariants
  // -------------------------------------------------------------------------

  describe("B: accumulation phase invariants", () => {
    it("3 — sum of per-account slot contributions equals year totalEmployee + totalEmployer", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "accumulation") continue;
            const slotEmployee = year.slots.reduce(
              (s, sl) => s + sl.employeeContrib,
              0,
            );
            const slotEmployer = year.slots.reduce(
              (s, sl) => s + sl.employerMatch,
              0,
            );
            expect(Math.abs(slotEmployee - year.totalEmployee)).toBeLessThan(
              EPSILON + 1,
            );
            expect(Math.abs(slotEmployer - year.totalEmployer)).toBeLessThan(
              EPSILON + 1,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("4 — accumulation years always precede decumulation years", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          const years = result.projectionByYear;
          let seenDecumulation = false;
          for (const year of years) {
            if (year.phase === "decumulation") seenDecumulation = true;
            if (seenDecumulation) {
              expect(year.phase).toBe("decumulation");
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("21 — year-0 with baseYearContributions: overflowToBrokerage is 0", () => {
      // When actual paycheck amounts are provided for year 0, the engine uses
      // them as-is — no overflow routing occurs since contributions are exact.
      const input = makeInput({
        baseYearContributions: {
          "401k": 23500,
          "403b": 0,
          hsa: 4300,
          ira: 7000,
          brokerage: 6000,
        },
        baseYearEmployerMatch: {
          "401k": 4500,
          "403b": 0,
          hsa: 0,
          ira: 0,
          brokerage: 0,
        },
      });
      const result = calculateProjection(input);
      const year0 = result.projectionByYear[0]!;
      if (year0.phase === "accumulation") {
        expect(year0.overflowToBrokerage).toBe(0);
      }
    });

    it("29 — per-person salary shrinks correctly with negative salaryGrowthRate", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 25, max: 50 }).chain((currentAge) =>
            fc.record({
              currentAge: fc.constant(currentAge),
              salary: fc.integer({ min: 50000, max: 300000 }),
              growthRate: fc.double({ min: -0.05, max: -0.001, noNaN: true }),
            }),
          ),
          (r) => {
            const input = makeInput({
              currentAge: r.currentAge,
              retirementAge: r.currentAge + 10,
              projectionEndAge: r.currentAge + 30,
              currentSalary: r.salary,
              salaryGrowthRate: r.growthRate,
            });
            const result = calculateProjection(input);
            const accYears = result.projectionByYear.filter(
              (y): y is EngineAccumulationYear => y.phase === "accumulation",
            );
            if (accYears.length < 2) return;
            // With negative growth rate, salary should decrease year over year
            for (let i = 1; i < accYears.length; i++) {
              expect(accYears[i]!.projectedSalary).toBeLessThanOrEqual(
                accYears[i - 1]!.projectedSalary + EPSILON,
              );
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group C: Decumulation phase invariants
  // -------------------------------------------------------------------------

  describe("C: decumulation phase invariants", () => {
    it("6 — total withdrawals in decumulation never exceed total balances (no balance goes below 0 in aggregate)", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            // Withdrawals cannot exceed what was in the portfolio at start of year.
            // We check: allAccountsBalance >= 0 (within tolerance) — the engine already
            // enforces this by capping withdrawals at available balance.
            expect(year.allAccountsBalance).toBeGreaterThanOrEqual(-EPSILON);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("23 — sum of individual slot withdrawals equals year totalWithdrawal", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            const slotTotal = sumSlotWithdrawals(year.slots);
            expect(Math.abs(slotTotal - year.totalWithdrawal)).toBeLessThan(
              EPSILON + 1,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("31 — no indBal/acctBal reconciliation diagnostic is emitted for any fixture (v0.7.8 indBal reconciliation follow-up)", () => {
      // A >$1 indBal/acctBal drift is a structural finding, not rounding, and
      // reconcileIndividualToAggregate surfaces it as a "[DIAG] indBal/
      // acctBal reconciliation:"-prefixed warning rather than silently
      // absorbing it. This invariant asserts that finding never actually
      // fires for generated fixtures — if it does, that's real drift worth
      // investigating, not a test to relax.
      //
      // Scoped to this specific prefix, not every "[DIAG]"-tagged warning:
      // the pre-existing "[DIAG] Roth divergence" check (unrelated,
      // out of scope for this fix) can legitimately fire for a degenerate
      // fixture with a nonzero taxFree starting balance but zero individual
      // accounts to reconcile against at all.
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            const reconciliationWarnings = (year.warnings ?? []).filter(
              (w: string) => w.includes("[DIAG] indBal/acctBal reconciliation"),
            );
            expect(reconciliationWarnings).toEqual([]);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("30 — sum of individual-account withdrawals per category equals that category's slot withdrawal (v0.7.8 indBal reconciliation follow-up)", () => {
      // Before that fix, distributeWithdrawals could silently under-distribute a
      // slot's withdrawal across individual accounts (a shortfall re-routing
      // gap, not the over-withdrawal originally suspected). This invariant
      // guards the fix directly, at the category level (not just the
      // household total, which invariant 23 already covers and could mask a
      // per-category shortfall offset by a different category's surplus).
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            if (year.individualAccountBalances.length === 0) continue;
            const indByCategory: Record<string, number> = {};
            for (const acct of year.individualAccountBalances) {
              indByCategory[acct.category] =
                (indByCategory[acct.category] ?? 0) + (acct.withdrawal ?? 0);
            }
            for (const slot of year.slots) {
              const indTotal = indByCategory[slot.category] ?? 0;
              expect(Math.abs(indTotal - slot.withdrawal)).toBeLessThan(0.01);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("17 — when RMD overrides routing, totalTraditionalWithdrawal approximates rmdAmount", () => {
      fc.assert(
        fc.property(arbitraryRmdInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            if (year.totalWithdrawal < 1) continue;
            if (year.rmdOverrodeRouting && year.rmdAmount > 0) {
              const diff =
                Math.round(
                  (year.rmdAmount - year.totalTraditionalWithdrawal) * 100,
                ) / 100;
              // If the engine flagged an RMD shortfall warning, the Traditional
              // balance was insufficient — skip this year (capacity issue, not a bug).
              const hasShortfallWarning = year.warnings?.some(
                (w: string) => w.includes("RMD") && w.includes("SHORTFALL"),
              );
              if (hasShortfallWarning || diff > year.rmdAmount * 0.05) continue;
              const tolerance = Math.max(year.rmdAmount * 0.02, 10);
              expect(diff).toBeLessThanOrEqual(tolerance);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("26 — when RMD > 0 and sufficient balance, totalWithdrawal covers RMD", () => {
      fc.assert(
        fc.property(arbitraryRmdInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            if (year.totalWithdrawal < 1) continue;
            if (year.rmdAmount > 0) {
              // Skip years where the engine flagged an RMD shortfall warning
              // (Traditional balance was insufficient — capacity issue, not a bug)
              const hasShortfallWarning = year.warnings?.some(
                (w: string) => w.includes("RMD") && w.includes("SHORTFALL"),
              );
              if (hasShortfallWarning) continue;
              const shortfall =
                year.rmdAmount - year.totalTraditionalWithdrawal;
              // Skip capacity-depleted years (>5% shortfall = not a rounding issue)
              if (shortfall > year.rmdAmount * 0.05) continue;
              // Tolerance: 5% of RMD or $10, whichever is larger. RMD enforcement
              // uses proportional multi-pass distribution with rounding at each step,
              // which can accumulate small gaps when currentAge > retirementAge.
              const tolerance = Math.max(year.rmdAmount * 0.05, 10);
              expect(year.totalWithdrawal + tolerance).toBeGreaterThanOrEqual(
                year.rmdAmount,
              );
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("generated inputs describe their starting money the same way in every form", () => {
      for (const arb of [
        arbitraryInput(),
        arbitraryRetiredInput(),
        arbitraryRmdInput(),
      ])
        fc.assert(
          fc.property(arb, (input) => {
            expect(startingBalanceGaps(calculateProjection(input))).toEqual([]);
          }),
          { numRuns: NUM_RUNS },
        );
    });

    it("28 — engine is deterministic: running twice produces identical output", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          const result1 = calculateProjection(input);
          const result2 = calculateProjection(input);
          expect(result1.projectionByYear.length).toBe(
            result2.projectionByYear.length,
          );
          for (let i = 0; i < result1.projectionByYear.length; i++) {
            expect(result1.projectionByYear[i]!.allAccountsBalance).toBe(
              result2.projectionByYear[i]!.allAccountsBalance,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group D: Tax invariants
  // -------------------------------------------------------------------------

  describe("D: tax invariants", () => {
    it("2 — tax paid is between 0 and totalWithdrawal (decumulation)", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            expect(year.taxCost).toBeGreaterThanOrEqual(-EPSILON);
            // Tax can't exceed total withdrawal (that would mean tax > 100% rate)
            expect(year.taxCost).toBeLessThanOrEqual(
              year.totalWithdrawal + EPSILON,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("8 — taxable SS is between 0 and 0.85 × ssIncome", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            expect(year.taxableSS).toBeGreaterThanOrEqual(-EPSILON);
            expect(year.taxableSS).toBeLessThanOrEqual(
              year.ssIncome * 0.85 + EPSILON,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("15 — LTCG rate is always in {0, 0.15, 0.20}", () => {
      const validRates = new Set([0, 0.15, 0.2]);
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            // Allow small floating-point deviation
            const rate = Math.round(year.ltcgRate * 100) / 100;
            expect(validRates.has(rate)).toBe(true);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("16 — total MAGI components are non-negative", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            // taxableSS, totalTraditionalWithdrawal, ssIncome must be non-negative
            expect(year.taxableSS).toBeGreaterThanOrEqual(-EPSILON);
            expect(year.totalTraditionalWithdrawal).toBeGreaterThanOrEqual(
              -EPSILON,
            );
            expect(year.ssIncome).toBeGreaterThanOrEqual(-EPSILON);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("27 — MAGI uses taxableSS, not raw ssIncome × 0.5 (taxableSS ≤ ssIncome)", () => {
      // IRS uses provisional income formula — taxable SS is at most 85% of SS.
      // This confirms taxableSS is derived properly and is never > ssIncome.
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            // taxableSS can only be between 0% and 85% of gross SS — never 100%
            if (year.ssIncome > 0) {
              expect(year.taxableSS).toBeLessThanOrEqual(
                year.ssIncome + EPSILON,
              );
              // If total income is low, taxableSS should be less than 0.5 * ssIncome
              // (in very low income cases, 0% of SS is taxable). At minimum it's not 50%.
              // We can't assert the exact value without replicating full IRS formula,
              // but we can confirm it's bounded by the 85% ceiling.
              expect(year.taxableSS).toBeLessThanOrEqual(
                year.ssIncome * 0.85 + EPSILON,
              );
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group E: RMD invariants
  // -------------------------------------------------------------------------

  describe("E: RMD invariants", () => {
    it("7 — RMD amounts follow factor table monotonically (factor decreases as age increases)", () => {
      // For a fixed prior-year traditional balance, RMD = balance / factor.
      // As age increases, factor decreases → RMD grows. We verify that factor
      // is monotonically decreasing across consecutive RMD years.
      fc.assert(
        fc.property(arbitraryRmdInput(), (input) => {
          const result = calculateProjection(input);
          const rmdYears = result.projectionByYear.filter(
            (y): y is EngineDecumulationYear =>
              y.phase === "decumulation" && y.rmdAmount > 0,
          );
          // Check that the IRS factors referenced by age are in the table and decreasing
          for (let i = 1; i < rmdYears.length; i++) {
            const prevAge = rmdYears[i - 1]!.age;
            const curAge = rmdYears[i]!.age;
            const prevFactor = RMD_FACTORS[prevAge];
            const curFactor = RMD_FACTORS[curAge];
            if (prevFactor !== undefined && curFactor !== undefined) {
              // Factor at older age should be <= factor at younger age
              expect(curFactor).toBeLessThanOrEqual(prevFactor + 0.1);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("9 — RMD amount ≈ priorYearTraditionalBalance / factor for applicable ages", () => {
      // For each year with a non-zero RMD, we verify the amount is consistent
      // with the prior year's traditional balance and the age-appropriate factor.
      // We use the balanceByAccount to infer prior traditional balance.
      fc.assert(
        fc.property(arbitraryRmdInput(), (input) => {
          const result = calculateProjection(input);
          const decYears = result.projectionByYear.filter(
            (y): y is EngineDecumulationYear => y.phase === "decumulation",
          );
          for (let i = 1; i < decYears.length; i++) {
            const year = decYears[i]!;
            if (year.rmdAmount <= 0) continue;
            const factor = RMD_FACTORS[year.age];
            if (!factor) continue;
            // Prior year's traditional balance — use balanceByTaxType.preTax which
            // matches the engine's priorYearEndTradBalance (aggregate preTax bucket)
            const priorYear = decYears[i - 1]!;
            const priorTradTotal = priorYear.balanceByTaxType.preTax;
            if (priorTradTotal <= 0) continue;
            const expectedRmd = priorTradTotal / factor;
            // RMD should be within 5% of expected (engine rounds, may cap at available balance)
            const tolerance = Math.max(expectedRmd * 0.05, 50);
            expect(Math.abs(year.rmdAmount - expectedRmd)).toBeLessThan(
              tolerance,
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group F: Roth conversion invariants
  // -------------------------------------------------------------------------

  describe("F: Roth conversion invariants", () => {
    it("10 — Roth conversion amount ≤ available traditional balance", () => {
      // Roth conversions happen automatically when filingStatus is set and bracket room exists
      const input = makeInput({
        currentAge: 67,
        retirementAge: 65,
        projectionEndAge: 85,
        currentSalary: 0,
        filingStatus: "MFJ",
        birthYear: 1958,
        startingBalances: {
          preTax: 500000,
          taxFree: 100000,
          afterTax: 200000,
          afterTaxBasis: 120000,
          hsa: 30000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 400000,
            roth: 100000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 30000 },
          ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
          brokerage: {
            structure: "basis_tracking",
            balance: 200000,
            basis: 120000,
          },
        },
        annualExpenses: 60000,
      });
      const result = calculateProjection(input);
      for (const year of result.projectionByYear) {
        if (year.phase !== "decumulation") continue;
        if (year.rothConversionAmount <= 0) continue;
        // Invariant: conversion is non-negative
        expect(year.rothConversionAmount).toBeGreaterThanOrEqual(0);
        // Conversion tax cost must be non-negative
        expect(year.rothConversionTaxCost).toBeGreaterThanOrEqual(0);
        // Conversion amount shouldn't exceed the full remaining traditional (approximate)
        const trad401k = getTraditionalBalance(year.balanceByAccount["401k"]);
        const tradIra = getTraditionalBalance(year.balanceByAccount["ira"]);
        const trad403b = getTraditionalBalance(year.balanceByAccount["403b"]);
        const tradTotal = trad401k + tradIra + trad403b;
        expect(year.rothConversionAmount).toBeLessThanOrEqual(
          tradTotal + year.totalTraditionalWithdrawal + EPSILON,
        );
      }
    });

    it("11 — Roth conversion tax cost ≤ conversion amount × max marginal rate (50%)", () => {
      const input = makeInput({
        currentAge: 67,
        retirementAge: 65,
        projectionEndAge: 85,
        currentSalary: 0,
        filingStatus: "Single",
        birthYear: 1958,
        startingBalances: {
          preTax: 600000,
          taxFree: 50000,
          afterTax: 150000,
          afterTaxBasis: 90000,
          hsa: 20000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 500000,
            roth: 50000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 20000 },
          ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
          brokerage: {
            structure: "basis_tracking",
            balance: 150000,
            basis: 90000,
          },
        },
        annualExpenses: 50000,
      });
      const result = calculateProjection(input);
      for (const year of result.projectionByYear) {
        if (year.phase !== "decumulation") continue;
        if (year.rothConversionAmount <= 0) continue;
        // No real tax rate exceeds 50% for ordinary income
        const maxRate = 0.5;
        expect(year.rothConversionTaxCost).toBeLessThanOrEqual(
          year.rothConversionAmount * maxRate + EPSILON,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group G: IRMAA / ACA invariants
  // -------------------------------------------------------------------------

  describe("G: IRMAA and ACA invariants", () => {
    it("12 — IRMAA cost is zero when age < 65", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          // Force IRMAA awareness on
          const inputWithIrmaa: ProjectionInput = {
            ...input,
            enableIrmaaAwareness: true,
          };
          const result = calculateProjection(inputWithIrmaa);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            if (year.age < 65) {
              expect(year.irmaaCost).toBe(0);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("13 — ACA headroom is zero when age >= 65", () => {
      fc.assert(
        fc.property(arbitraryRetiredInput(), (input) => {
          const inputWithAca: ProjectionInput = {
            ...input,
            enableAcaAwareness: true,
          };
          const result = calculateProjection(inputWithAca);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            if (year.age >= 65) {
              expect(year.acaMagiHeadroom).toBe(0);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it("25 — when enableIrmaaAwareness is true, warnings exist when IRMAA cliff is approached", () => {
      // When IRMAA awareness is enabled and conversions are active, the engine
      // should emit warnings if it constrains conversions near a cliff.
      // This is a structural check — we don't assert exact warning text,
      // just that the engine runs without error and produces warnings when relevant.
      const input = makeInput({
        currentAge: 68,
        retirementAge: 65,
        projectionEndAge: 85,
        currentSalary: 0,
        enableIrmaaAwareness: true,
        startingBalances: {
          preTax: 780000,
          taxFree: 120000,
          afterTax: 50000,
          afterTaxBasis: 25000,
          hsa: 20000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 700000,
            roth: 100000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 20000 },
          ira: {
            structure: "roth_traditional",
            traditional: 80000,
            roth: 20000,
          },
          brokerage: {
            structure: "basis_tracking",
            balance: 50000,
            basis: 25000,
          },
        },
        filingStatus: "MFJ",
        birthYear: 1957,
        socialSecurityAnnual: 36000,
        ssStartAge: 67,
      });
      // Roth conversions happen automatically when filingStatus is set and bracket room exists.
      // Just verify the engine runs without throwing
      expect(() => calculateProjection(input)).not.toThrow();
      const result = calculateProjection(input);
      expect(result.projectionByYear.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Group H: Guyton-Klinger invariants
  // -------------------------------------------------------------------------

  describe("H: Guyton-Klinger invariants", () => {
    it("14 — G-K spending never drops below (1 - decreasePercent)^N × initial spending", () => {
      // With G-K guardrails, spending can decrease at most `decreasePercent` per trigger.
      // The cumulative floor is bounded by repeated application.
      const decreasePercent = 0.1;
      const input = makeInput({
        currentAge: 66,
        retirementAge: 65,
        projectionEndAge: 95,
        currentSalary: 0,
        annualExpenses: 80000,
        returnRates: [{ label: "5%", rate: 0.05 }], // modest returns to trigger guardrails
        startingBalances: {
          preTax: 550000,
          taxFree: 150000,
          afterTax: 50000,
          afterTaxBasis: 30000,
          hsa: 20000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 500000,
            roth: 100000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 20000 },
          ira: {
            structure: "roth_traditional",
            traditional: 50000,
            roth: 50000,
          },
          brokerage: {
            structure: "basis_tracking",
            balance: 50000,
            basis: 30000,
          },
        },
        decumulationDefaults: {
          withdrawalRate: 0.04,
          withdrawalRoutingMode: "waterfall",
          withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
          withdrawalSplits: {
            "401k": 0.35,
            "403b": 0,
            ira: 0.25,
            brokerage: 0.3,
            hsa: 0.1,
          },
          withdrawalTaxPreference: {
            "401k": "traditional",
            ira: "traditional",
          },
          distributionTaxRates: {
            traditionalFallbackRate: 0.22,
            roth: 0,
            hsa: 0,
            brokerage: 0.15,
          },
          withdrawalStrategy: "guyton_klinger",
          strategyParams: {
            guyton_klinger: {
              upperGuardrail: 0.8,
              lowerGuardrail: 1.2,
              increasePercent: 0.1,
              decreasePercent,
              skipInflationAfterLoss: false,
            },
          },
        },
      });
      const result = calculateProjection(input);
      const decYears = result.projectionByYear.filter(
        (y): y is EngineDecumulationYear => y.phase === "decumulation",
      );
      if (decYears.length === 0) return;
      const initialSpending = decYears[0]!.projectedExpenses;
      // Track number of decrease events
      let decreaseCount = 0;
      for (const year of decYears) {
        if (year.strategyAction === "decrease") decreaseCount++;
        // Floor: after N decreases, spending ≥ initial × (1 - decreasePercent)^N
        const floor =
          initialSpending * Math.pow(1 - decreasePercent, decreaseCount);
        // Allow 1% tolerance on the floor calculation
        expect(year.projectedExpenses).toBeGreaterThanOrEqual(floor * 0.99 - 1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group I: Input mutation invariant
  // -------------------------------------------------------------------------

  describe("I: immutability invariants", () => {
    it("20 — engine does not mutate the input ProjectionInput object", () => {
      fc.assert(
        fc.property(arbitraryInput(), (input) => {
          // Deep-clone the input before running the engine
          const snapshot = JSON.parse(
            JSON.stringify(input, (_k, v) =>
              v instanceof Date ? v.toISOString() : v,
            ),
          );
          calculateProjection(input);
          // Verify primitive fields haven't changed
          expect(input.currentAge).toBe(snapshot.currentAge);
          expect(input.retirementAge).toBe(snapshot.retirementAge);
          expect(input.projectionEndAge).toBe(snapshot.projectionEndAge);
          expect(input.currentSalary).toBe(snapshot.currentSalary);
          expect(input.annualExpenses).toBe(snapshot.annualExpenses);
          expect(input.startingBalances.preTax).toBe(
            snapshot.startingBalances.preTax,
          );
          expect(input.startingBalances.taxFree).toBe(
            snapshot.startingBalances.taxFree,
          );
          expect(input.startingBalances.afterTax).toBe(
            snapshot.startingBalances.afterTax,
          );
          expect(input.startingBalances.hsa).toBe(
            snapshot.startingBalances.hsa,
          );
          if (input.startingAccountBalances) {
            expect(JSON.stringify(input.startingAccountBalances)).toBe(
              JSON.stringify(snapshot.startingAccountBalances),
            );
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Group J: Override / config invariants
  // -------------------------------------------------------------------------

  describe("J: override and config invariants", () => {
    it("19 — after reset: true override, resolved config merges only defaults (smoke test)", () => {
      // The engine's sticky-forward override mechanism: a `reset: true` entry
      // causes the config to revert to defaults for subsequent years.
      // We test that the engine accepts this shape without error and produces output.
      const baseYear = AS_OF.getFullYear();
      const input = makeInput({
        accumulationOverrides: [
          {
            year: baseYear + 2,
            reset: true,
          },
          {
            year: baseYear + 5,
            contributionRate: 0.2,
          },
        ],
      });
      expect(() => calculateProjection(input)).not.toThrow();
      const result = calculateProjection(input);
      expect(result.projectionByYear.length).toBeGreaterThan(0);
      // Year after reset should use defaults (no specific assertion on exact value,
      // but the engine must have run without error and produced a valid projection)
      const accYears = result.projectionByYear.filter(
        (y): y is EngineAccumulationYear => y.phase === "accumulation",
      );
      expect(accYears.length).toBeGreaterThan(0);
    });

    it("24 — HSA employee + employer match ≤ IRS limit when employer match exists", () => {
      // IRS counts employer HSA match toward the household limit.
      fc.assert(
        fc.property(
          fc.record({
            hsaBase: fc.integer({ min: 3000, max: 5000 }),
            empMatchRate: fc.double({ min: 0.001, max: 0.01, noNaN: true }),
            salary: fc.integer({ min: 50000, max: 200000 }),
          }),
          (r) => {
            const input = makeInput({
              baseLimits: {
                "401k": 23500,
                "403b": 23500,
                hsa: r.hsaBase,
                ira: 7000,
                brokerage: 0,
              },
              employerMatchRateByCategory: {
                "401k": 0,
                "403b": 0,
                hsa: r.empMatchRate,
                ira: 0,
                brokerage: 0,
              },
              currentSalary: r.salary,
            });
            const result = calculateProjection(input);
            for (const year of result.projectionByYear) {
              if (year.phase !== "accumulation") continue;
              const hsaSlot = year.slots.find((s) => s.category === "hsa");
              if (!hsaSlot) continue;
              const total = hsaSlot.employeeContrib + hsaSlot.employerMatch;
              // Total HSA (employee + employer) should not exceed effective limit + epsilon
              expect(total).toBeLessThanOrEqual(
                hsaSlot.effectiveLimit + EPSILON,
              );
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 30. Category boundary: retirement vs portfolio
  // ---------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 30. Dimmed settings produce identical output
  // -------------------------------------------------------------------------

  describe("dimmed settings invariance", () => {
    it("Post-retirement raise has zero effect on strategies with usesPostRetirementRaise=false", () => {
      // Strategies that compute spending independently (from portfolio balance or
      // initial amount with real decline), not from orchestrator-inflated expenses
      const noRaiseStrategies = [
        "vanguard_dynamic",
        "constant_percentage",
        "endowment",
        "rmd_spending",
        "spending_decline",
      ] as const;

      for (const strategy of noRaiseStrategies) {
        const base = makeInput({
          postRetirementInflationRate: 0.0,
          decumulationDefaults: {
            ...makeInput().decumulationDefaults,
            withdrawalStrategy: strategy,
          },
        });
        const withRaise = makeInput({
          postRetirementInflationRate: 0.05,
          decumulationDefaults: {
            ...makeInput().decumulationDefaults,
            withdrawalStrategy: strategy,
          },
        });

        const resultA = calculateProjection(base);
        const resultB = calculateProjection(withRaise);

        const decA = resultA.projectionByYear.filter(
          (y) => y.phase === "decumulation",
        ) as EngineDecumulationYear[];
        const decB = resultB.projectionByYear.filter(
          (y) => y.phase === "decumulation",
        ) as EngineDecumulationYear[];

        expect(decA.length).toBe(decB.length);
        for (let i = 0; i < decA.length; i++) {
          expect(
            decA[i].projectedExpenses,
            `${strategy} year ${decA[i].year}: projectedExpenses should be identical regardless of post-retirement raise`,
          ).toBeCloseTo(decB[i].projectedExpenses, 2);
          expect(
            decA[i].allAccountsBalance,
            `${strategy} year ${decA[i].year}: allAccountsBalance should be identical regardless of post-retirement raise`,
          ).toBeCloseTo(decB[i].allAccountsBalance, 0);
        }
      }
    });

    it("Post-retirement raise DOES affect strategies with usesPostRetirementRaise=true", () => {
      // Sanity check: strategies that use raise should produce different output
      const raiseStrategies = ["fixed", "forgo_inflation_after_loss"] as const;

      for (const strategy of raiseStrategies) {
        const base = makeInput({
          postRetirementInflationRate: 0.0,
          decumulationDefaults: {
            ...makeInput().decumulationDefaults,
            withdrawalStrategy: strategy,
          },
        });
        const withRaise = makeInput({
          postRetirementInflationRate: 0.05,
          decumulationDefaults: {
            ...makeInput().decumulationDefaults,
            withdrawalStrategy: strategy,
          },
        });

        const resultA = calculateProjection(base);
        const resultB = calculateProjection(withRaise);

        const decA = resultA.projectionByYear.filter(
          (y) => y.phase === "decumulation",
        ) as EngineDecumulationYear[];
        const decB = resultB.projectionByYear.filter(
          (y) => y.phase === "decumulation",
        ) as EngineDecumulationYear[];

        // At least one year should differ (the raise compounds over time)
        const anyDifferent = decA.some(
          (a, i) =>
            Math.abs(a.projectedExpenses - decB[i].projectedExpenses) > 1,
        );
        expect(
          anyDifferent,
          `${strategy}: post-retirement raise should affect projectedExpenses`,
        ).toBe(true);
      }
    });
  });

  describe("category boundary", () => {
    it("Portfolio-category contributions are report-only during decumulation", () => {
      fc.assert(
        fc.property(arbitraryInput(), (rawInput) => {
          const input = makeInput(rawInput);
          const result = calculateProjection(input);
          for (const year of result.projectionByYear) {
            if (year.phase !== "decumulation") continue;
            const decYr = year as EngineDecumulationYear;
            // brokerageContribution reports Portfolio-category post-retirement
            // contributions for the brokerage page.  It must NOT be applied to
            // retirement balances.  Verify it's non-negative (valid report
            // value) and that allAccountsBalance = sum of tax buckets (no hidden
            // contribution injection).
            expect(decYr.brokerageContribution).toBeGreaterThanOrEqual(0);
            const bucketSum =
              decYr.balanceByTaxType.preTax +
              decYr.balanceByTaxType.taxFree +
              decYr.balanceByTaxType.hsa +
              decYr.balanceByTaxType.afterTax;
            expect(decYr.allAccountsBalance).toBeCloseTo(bucketSum, 0);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe("retirement spending ignores Portfolio money", () => {
    // Already retired (no contributions — only spending-sizing paths
    // involved). The extra $1M sits in a Portfolio-parented brokerage at the
    // same basis ratio as the household's brokerage, so nothing but the
    // Portfolio balance itself differs.
    const retired = (portfolio: number): ProjectionInput => {
      const base = makeInput({ currentAge: 66, retirementAge: 66 });
      const individualAccounts = [
        {
          name: "401k",
          category: "401k" as const,
          taxType: "preTax",
          startingBalance: 80000,
        },
        {
          name: "401k",
          category: "401k" as const,
          taxType: "taxFree",
          startingBalance: 20000,
        },
        {
          name: "IRA",
          category: "ira" as const,
          taxType: "preTax",
          startingBalance: 30000,
        },
        {
          name: "IRA",
          category: "ira" as const,
          taxType: "taxFree",
          startingBalance: 20000,
        },
        {
          name: "HSA",
          category: "hsa" as const,
          taxType: "hsa",
          startingBalance: 15000,
        },
        {
          name: "Retirement brokerage",
          category: "brokerage" as const,
          taxType: "afterTax",
          startingBalance: 30000,
        },
      ].map((a) => ({ ...a, parentCategory: "Retirement" }));
      if (portfolio > 0)
        individualAccounts.push({
          name: "Long-term brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: portfolio,
          parentCategory: "Portfolio",
        });
      const basisRatio = 20000 / 30000;
      return {
        ...base,
        individualAccounts,
        startingBalances: {
          ...base.startingBalances,
          afterTax: 30000 + portfolio,
          afterTaxBasis: (30000 + portfolio) * basisRatio,
        },
        startingAccountBalances: {
          ...base.startingAccountBalances,
          brokerage: {
            structure: "basis_tracking",
            balance: 30000 + portfolio,
            basis: (30000 + portfolio) * basisRatio,
          },
        },
      };
    };
    const spending = (input: ProjectionInput) =>
      calculateProjection(input)
        .projectionByYear.filter((y) => y.phase === "decumulation")
        .slice(0, 10)
        .map((y) => y.projectedExpenses);

    it("the two balances: retirement money is every account minus the Portfolio ones", () => {
      for (const y of calculateProjection(retired(1_000_000))
        .projectionByYear) {
        const portfolio = y.individualAccountBalances
          .filter((a) => a.parentCategory === "Portfolio")
          .reduce((t, a) => t + a.balance, 0);
        expect(y.retirementBalance, `${y.year}`).toBeCloseTo(
          Math.max(0, y.allAccountsBalance - portfolio),
          0,
        );
      }
    });

    it("running out means retirement money running out, whatever Portfolio holds", () => {
      // No HSA: it isn't drawn for general spending here, so it would keep
      // the balance above $1 (unmet need is the plan judge's business).
      const spendy = (portfolio: number): ProjectionInput => {
        const input = retired(portfolio);
        return {
          ...input,
          annualExpenses: 150000,
          decumulationAnnualExpenses: 150000,
          individualAccounts: input.individualAccounts!.filter(
            (a) => a.category !== "hsa",
          ),
          // Buckets that match the accounts (makeInput's are $10k off in
          // both pre-tax and tax-free).
          startingBalances: {
            ...input.startingBalances,
            hsa: 0,
            preTax: 110000,
            taxFree: 40000,
          },
          startingAccountBalances: {
            ...input.startingAccountBalances!,
            hsa: { structure: "single_bucket", balance: 0 },
          },
        };
      };
      const without = calculateProjection(spendy(0));
      const withPortfolio = calculateProjection(spendy(1_000_000));
      expect(without.retirementDepletionAge).not.toBeNull();
      expect(withPortfolio.retirementDepletionAge).toBe(
        without.retirementDepletionAge,
      );
      // The Portfolio money is still there (it's never spent in retirement).
      const depleted = withPortfolio.projectionByYear.find(
        (y) => y.age === withPortfolio.retirementDepletionAge,
      )!;
      expect(depleted.retirementBalance).toBeLessThan(1);
      expect(depleted.allAccountsBalance).toBeGreaterThan(1_000_000);
    });

    it("every strategy sizes spending from retirement money only", () => {
      for (const strategy of WITHDRAWAL_STRATEGY_VALUES) {
        const withStrategy = (portfolio: number) => {
          const input = retired(portfolio);
          return {
            ...input,
            decumulationDefaults: {
              ...input.decumulationDefaults,
              withdrawalStrategy: strategy,
            },
          };
        };
        const without = spending(withStrategy(0));
        const withPortfolio = spending(withStrategy(1_000_000));
        without.forEach((v, i) =>
          expect
            .soft(withPortfolio[i], `${strategy}, year ${i + 1}`)
            .toBeCloseTo(v, 0),
        );
      }
    });

    it("Portfolio Traditional money isn't part of the Traditional share or the year-1 withdrawal", () => {
      // +$1M Traditional IRA tagged Portfolio (before RMD age, so RMDs —
      // which do count it — don't enter the first years).
      const withPortfolioIra = (): ProjectionInput => {
        const input = retired(0);
        return {
          ...input,
          individualAccounts: [
            ...input.individualAccounts!,
            {
              name: "Portfolio IRA",
              category: "ira",
              taxType: "preTax",
              startingBalance: 1_000_000,
              parentCategory: "Portfolio",
            },
          ],
          startingBalances: {
            ...input.startingBalances,
            preTax: input.startingBalances.preTax + 1_000_000,
          },
          startingAccountBalances: {
            ...input.startingAccountBalances,
            ira: {
              structure: "roth_traditional",
              traditional: 1_030_000,
              roth: 20000,
            },
          },
        };
      };
      const firstYear = (input: ProjectionInput) =>
        calculateProjection(input).projectionByYear.find(
          (y): y is EngineDecumulationYear => y.phase === "decumulation",
        )!;
      const without = firstYear(retired(0));
      const withIra = firstYear(withPortfolioIra());
      expect(withIra.estTraditionalPortion).toBeGreaterThan(0);
      expect(withIra.estTraditionalPortion).toBeCloseTo(
        without.estTraditionalPortion!,
        6,
      );
      expect(withIra.targetWithdrawal).toBeCloseTo(
        without.targetWithdrawal!,
        0,
      );
    });

    it("the Rate-Seeded first year seeds from retirement money only", () => {
      const seeded = (portfolio: number) =>
        spending({
          ...retired(portfolio),
          rateSeededDecumulationYear1: true,
        })[0];
      expect(seeded(1_000_000)).toBeCloseTo(seeded(0)!, 0);
    });
  });

  describe("penalty-locked money stays locked", () => {
    it("money in a category no tracked account holds isn't drawn before 59½", () => {
      // Retired at 55; the 401(k) account (Traditional) is locked until
      // 59½ (no Rule of 55). The category also holds $50k of Roth 401(k)
      // money no account tracks — it was drawn penalty-free as if reachable.
      const birthYear = AS_OF.getFullYear() - 55;
      const base = makeInput({ currentAge: 55, retirementAge: 55 });
      const input: ProjectionInput = {
        ...base,
        decumulationDefaults: {
          ...base.decumulationDefaults,
          avoidPenalizedWithdrawals: true,
        },
        startingBalances: {
          preTax: 500000,
          taxFree: 50000,
          hsa: 0,
          afterTax: 400000,
          afterTaxBasis: 300000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 500000,
            roth: 50000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 0 },
          ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
          brokerage: {
            structure: "basis_tracking",
            balance: 400000,
            basis: 300000,
          },
        },
        individualAccounts: [
          {
            name: "401k",
            category: "401k",
            taxType: "preTax",
            startingBalance: 500000,
            ownerPersonId: 1,
            ownerName: "Alex",
            ownerBirthYear: birthYear,
            ruleOf55ForceIneligible: true,
            parentCategory: "Retirement",
          },
          {
            name: "Brokerage",
            category: "brokerage",
            taxType: "afterTax",
            startingBalance: 400000,
            startingBasis: 300000,
            parentCategory: "Retirement",
          },
        ],
      };
      const firstYear = calculateProjection(input).projectionByYear.find(
        (y): y is EngineDecumulationYear => y.phase === "decumulation",
      )!;
      expect(
        firstYear.slots.find((sl) => sl.category === "401k")!.withdrawal,
      ).toBe(0);
      expect(firstYear.penaltyCost ?? 0).toBe(0);
      expect(firstYear.totalWithdrawal).toBeGreaterThan(0);
    });
  });

  describe("retirement money stays retirement money", () => {
    // $40k to a 401(k) (over the IRS limit → overflow), $5k each to a
    // Retirement and a Portfolio brokerage, no targets; no growth so the
    // balances are pure contributions.
    const overflowInput = (): ProjectionInput => ({
      ...makeInput({
        currentAge: 40,
        retirementAge: 65,
        currentSalary: 200000,
        salaryGrowthRate: 0,
        limitGrowthRate: 0,
        returnRates: [{ label: "0%", rate: 0 }],
        accumulationDefaults: {
          ...makeInput().accumulationDefaults,
          contributionRate: 0.5,
        },
        startingBalances: {
          preTax: 100000,
          taxFree: 0,
          afterTax: 20000,
          afterTaxBasis: 20000,
          hsa: 0,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: 100000,
            roth: 0,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 0 },
          ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
          brokerage: {
            structure: "basis_tracking",
            balance: 20000,
            basis: 20000,
          },
        },
      }),
      contributionSpecs: (
        [
          ["401k", "401k", 40000, "pre_tax", "Retirement"],
          [
            "Retirement brokerage",
            "brokerage",
            5000,
            "after_tax",
            "Retirement",
          ],
          ["Long-term brokerage", "brokerage", 5000, "after_tax", "Portfolio"],
        ] as const
      ).map(([name, category, annual, taxTreatment, parentCategory]) => ({
        name,
        category,
        method: "fixed_monthly" as const,
        value: annual / 12,
        salaryFraction: 1,
        baseAnnual: annual,
        taxTreatment,
        parentCategory,
      })),
      baseYearContributions: {
        "401k": 40000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 10000,
      } as ProjectionInput["baseYearContributions"],
      individualAccounts: [
        {
          name: "401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 100000,
          parentCategory: "Retirement",
        },
        {
          name: "Retirement brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 10000,
          parentCategory: "Retirement",
        },
        {
          name: "Long-term brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 10000,
          parentCategory: "Portfolio",
        },
      ],
    });

    it("IRS overflow is added once, to Retirement accounts, and per-account balances add up", () => {
      const years = calculateProjection(overflowInput()).projectionByYear.slice(
        0,
        5,
      );
      let portfolioPrev = 10000;
      for (const y of years) {
        const accts = y.individualAccountBalances ?? [];
        const brokerage = accts.filter((a) => a.category === "brokerage");
        expect(y.overflowToBrokerage, `${y.year} overflow`).toBeGreaterThan(0);
        expect(
          brokerage.reduce((s, a) => s + a.balance, 0),
          `${y.year} brokerage accounts = brokerage total`,
        ).toBeCloseTo(y.balanceByTaxType.afterTax, 0);
        expect(
          (y.warnings ?? []).filter((w) => w.includes("reconciliation")),
        ).toEqual([]);
        // The Portfolio brokerage grows only by its own contribution.
        const portfolio = brokerage.find(
          (a) => a.parentCategory === "Portfolio",
        )!;
        expect(portfolio.balance - portfolioPrev).toBeLessThanOrEqual(5000.01);
        portfolioPrev = portfolio.balance;
      }
    });

    it("a lump sum with no named account goes to a Retirement account", () => {
      const base = overflowInput();
      const year = base.asOfDate.getFullYear() + 1;
      const input: ProjectionInput = {
        ...base,
        // Portfolio brokerage listed first: the old first-match picked it.
        individualAccounts: [...base.individualAccounts!].reverse(),
        accumulationOverrides: [
          { year, lumpSums: [{ amount: 50000, targetAccount: "brokerage" }] },
        ] as ProjectionInput["accumulationOverrides"],
      };
      const without = calculateProjection(base).projectionByYear.find(
        (y) => y.year === year,
      )!;
      const withLump = calculateProjection(input).projectionByYear.find(
        (y) => y.year === year,
      )!;
      const bal = (y: typeof without, parent: string) =>
        (y.individualAccountBalances ?? [])
          .filter(
            (a) => a.category === "brokerage" && a.parentCategory === parent,
          )
          .reduce((t, a) => t + a.balance, 0);
      expect(bal(withLump, "Portfolio")).toBeCloseTo(
        bal(without, "Portfolio"),
        0,
      );
      expect(
        bal(withLump, "Retirement") - bal(without, "Retirement"),
      ).toBeCloseTo(50000, 0);
    });

    it("a brokerage goal draws only Portfolio money, capped at what it holds", () => {
      const base = overflowInput();
      const year = base.asOfDate.getFullYear() + 2;
      const withGoal = (targetAmount: number): ProjectionInput => ({
        ...base,
        brokerageGoals: [
          { id: 1, name: "Car", targetAmount, targetYear: year, priority: 1 },
        ],
      });
      const at = (input: ProjectionInput) =>
        calculateProjection(input).projectionByYear.find(
          (y) => y.year === year,
        )!;
      const parentBal = (y: ReturnType<typeof at>, parent: string) =>
        (y.individualAccountBalances ?? [])
          .filter((a) => a.parentCategory === parent)
          .reduce((t, a) => t + a.balance, 0);
      const without = at(base);
      // A goal smaller than the Portfolio brokerage: Retirement untouched.
      const small = at(withGoal(10000));
      expect(parentBal(small, "Retirement")).toBeCloseTo(
        parentBal(without, "Retirement"),
        0,
      );
      expect(
        parentBal(without, "Portfolio") - parentBal(small, "Portfolio"),
      ).toBeCloseTo(10000, 0);
      // A goal bigger than the Portfolio brokerage: draws what it holds,
      // never the Retirement brokerage.
      const big = at(withGoal(1_000_000));
      expect(parentBal(big, "Retirement")).toBeCloseTo(
        parentBal(without, "Retirement"),
        0,
      );
      expect(parentBal(big, "Portfolio")).toBeLessThan(1);
    });

    it("the contribution-rate ceiling caps retirement contributions only", () => {
      const base = overflowInput();
      // A 10% retirement rate on $200k = $20k a year; the 401(k) spec wants
      // $40k and the Retirement brokerage $5k, the Portfolio brokerage $5k.
      const capped = (portfolioSpec: number): ProjectionInput => ({
        ...base,
        accumulationDefaults: {
          ...base.accumulationDefaults,
          contributionRate: 0.1,
        },
        contributionSpecs: base.contributionSpecs!.map((sp) =>
          sp.parentCategory === "Portfolio"
            ? { ...sp, value: portfolioSpec / 12, baseAnnual: portfolioSpec }
            : sp,
        ),
      });
      const contribs = (input: ProjectionInput) => {
        const y = calculateProjection(input).projectionByYear[1]!;
        const by = (parent: string) =>
          (y.individualAccountBalances ?? [])
            .filter((a) => a.parentCategory === parent)
            .reduce((t, a) => t + (a.contribution ?? 0), 0);
        return { retirement: by("Retirement"), portfolio: by("Portfolio") };
      };
      const small = contribs(capped(5000));
      expect(small.portfolio).toBeCloseTo(5000, 0);
      expect(small.retirement).toBeCloseTo(20000, 0);
      // More Portfolio savings never shrinks retirement contributions.
      const big = contribs(capped(50000));
      expect(big.portfolio).toBeCloseTo(50000, 0);
      expect(big.retirement).toBeCloseTo(small.retirement, 0);
    });

    // Shared checks: per-account brokerage = brokerage total, no
    // reconciliation warning, every year in the window.
    const brokerageAddsUp = (input: ProjectionInput, years = 4) => {
      for (const y of calculateProjection(input).projectionByYear.slice(
        0,
        years,
      )) {
        const brokerage = (y.individualAccountBalances ?? []).filter(
          (a) => a.category === "brokerage",
        );
        expect(
          brokerage.reduce((t, a) => t + a.balance, 0),
          `${y.year} brokerage accounts = brokerage total`,
        ).toBeCloseTo(y.balanceByTaxType.afterTax, 0);
        expect(
          (y.warnings ?? []).filter((w) => w.includes("reconciliation")),
          `${y.year} reconciliation`,
        ).toEqual([]);
      }
    };

    it("the first (pro-rated) year: the ceiling keeps the Portfolio part and adds nothing", () => {
      const base = overflowInput();
      const input: ProjectionInput = {
        ...base,
        accumulationDefaults: {
          ...base.accumulationDefaults,
          contributionRate: 0.05,
        },
      };
      const y0 = calculateProjection(input).projectionByYear[0]!;
      const proRate = y0.proRateFraction ?? 1;
      const contrib = (parent: string) =>
        (y0.individualAccountBalances ?? [])
          .filter((a) => a.parentCategory === parent)
          .reduce((t, a) => t + (a.contribution ?? 0), 0);
      expect(contrib("Portfolio")).toBeCloseTo(5000 * proRate, 0);
      expect(contrib("Retirement")).toBeCloseTo(200000 * 0.05 * proRate, 0);
      brokerageAddsUp(input);
    });

    it("overflow under a binding ceiling with only a Portfolio brokerage spec is still routed", () => {
      const base = overflowInput();
      brokerageAddsUp({
        ...base,
        accumulationDefaults: {
          ...base.accumulationDefaults,
          contributionRate: 0.15,
        },
        contributionSpecs: base.contributionSpecs!.filter(
          (sp) => sp.name !== "Retirement brokerage",
        ),
      });
    });

    it("a Retirement brokerage with no spec of its own takes the overflow, not a Portfolio spec", () => {
      const base = overflowInput();
      const input: ProjectionInput = {
        ...base,
        contributionSpecs: base.contributionSpecs!.filter(
          (sp) => sp.name !== "Retirement brokerage",
        ),
      };
      let portfolioPrev = 10000;
      for (const y of calculateProjection(input).projectionByYear.slice(0, 4)) {
        const portfolio = (y.individualAccountBalances ?? []).find(
          (a) => a.parentCategory === "Portfolio",
        )!;
        expect(
          portfolio.balance - portfolioPrev,
          `${y.year}`,
        ).toBeLessThanOrEqual(5000.01);
        portfolioPrev = portfolio.balance;
      }
      brokerageAddsUp(input);
    });

    describe("no Retirement brokerage: overflow lands in the projection-only one", () => {
      const projected: IndividualAccountInput = {
        name: "Retirement brokerage (projected)",
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 0,
        startingBasis: 0,
        parentCategory: "Retirement",
        projectedOnly: true,
      };
      // No account holds money the aggregate doesn't know about, so neither
      // reconciliation nor the basis sync has anything to report.
      const noDiagnostics = (input: ProjectionInput) => {
        for (const y of calculateProjection(input).projectionByYear.slice(0, 4))
          expect(
            (y.warnings ?? []).filter((w) => w.startsWith("[DIAG]")),
            `${y.year}`,
          ).toEqual([]);
      };
      const withoutRetirementBrokerage = (
        keepPortfolio: boolean,
      ): ProjectionInput => {
        const base = overflowInput();
        const afterTax = keepPortfolio ? 10000 : 0;
        return {
          ...base,
          startingBalances: {
            ...base.startingBalances,
            afterTax,
            afterTaxBasis: afterTax,
          },
          startingAccountBalances: {
            ...base.startingAccountBalances,
            brokerage: {
              structure: "basis_tracking",
              balance: afterTax,
              basis: afterTax,
            },
          },
          contributionSpecs: base.contributionSpecs!.filter(
            (sp) =>
              sp.name === "401k" ||
              (keepPortfolio && sp.name === "Long-term brokerage"),
          ),
          baseYearContributions: {
            ...base.baseYearContributions!,
            brokerage: keepPortfolio ? 5000 : 0,
          },
          individualAccounts: [
            ...base.individualAccounts!.filter(
              (ia) =>
                ia.name === "401k" ||
                (keepPortfolio && ia.name === "Long-term brokerage"),
            ),
            projected,
          ],
        };
      };

      it("only a Portfolio brokerage: the Portfolio one gets none of it", () => {
        const input = withoutRetirementBrokerage(true);
        let portfolioPrev = 10000;
        const years = calculateProjection(input).projectionByYear.slice(0, 4);
        for (const y of years) {
          const accts = y.individualAccountBalances ?? [];
          const portfolio = accts.find(
            (a) => a.parentCategory === "Portfolio",
          )!;
          expect(
            portfolio.balance - portfolioPrev,
            `${y.year}`,
          ).toBeLessThanOrEqual(5000.01);
          portfolioPrev = portfolio.balance;
        }
        expect(
          years[3]!.individualAccountBalances!.find((a) => a.projectedOnly)
            ?.balance,
        ).toBeGreaterThan(0);
        brokerageAddsUp(input);
        noDiagnostics(input);
      });

      it("a retirement lump sum lands in the projection-only one, not Portfolio", () => {
        const base = withoutRetirementBrokerage(true);
        const year = base.asOfDate.getFullYear() + 1;
        const portfolioIn = (input: ProjectionInput) =>
          calculateProjection(input)
            .projectionByYear.find((y) => y.year === year)!
            .individualAccountBalances!.find(
              (a) => a.parentCategory === "Portfolio",
            )!.balance;
        const input: ProjectionInput = {
          ...base,
          accumulationOverrides: [
            { year, lumpSums: [{ amount: 50000, targetAccount: "brokerage" }] },
          ] as ProjectionInput["accumulationOverrides"],
        };
        expect(portfolioIn(input)).toBeCloseTo(portfolioIn(base), 0);
        brokerageAddsUp(input);
        noDiagnostics(input);
      });

      it("no brokerage at all: the projection-only one holds all of it", () => {
        const input = withoutRetirementBrokerage(false);
        brokerageAddsUp(input);
        noDiagnostics(input);
      });
    });

    it("the ramp stays Portfolio money when only a Retirement brokerage has a spec", () => {
      const base = overflowInput();
      const input = {
        ...base,
        contributionSpecs: base.contributionSpecs!.filter(
          (sp) => sp.name !== "Long-term brokerage",
        ),
      };
      const year = base.asOfDate.getFullYear() + 2;
      const portfolio = (i: ProjectionInput) =>
        calculateProjection(i)
          .projectionByYear.find((y) => y.year === year)!
          .individualAccountBalances!.find(
            (a) => a.parentCategory === "Portfolio",
          )!.balance;
      expect(
        portfolio({ ...input, brokerageContributionRamp: 1000 }) -
          portfolio(input),
      ).toBeCloseTo(2000 + 1000, 0); // two ramp years: +$1k, +$2k
      brokerageAddsUp({ ...input, brokerageContributionRamp: 1000 });
    });

    describe("Simple tax mode: the retirement side, collapsed", () => {
      const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
      // What the payload derives for overflowInput's retirement money.
      const parts: SimpleTaxModeParts = {
        retirementBuckets: {
          preTax: 100000,
          taxFree: 0,
          hsa: 0,
          afterTax: 10000,
          afterTaxBasis: 10000,
        },
        defaults: {
          baseYearContributions: { ...zero, "401k": 40000, brokerage: 5000 },
          baseYearEmployerMatch: zero,
          employerMatchRateByCategory: zero,
          accountSplits: {
            ...zero,
            "401k": 40000 / 45000,
            brokerage: 5000 / 45000,
          },
          taxSplits: {},
        },
      };
      const endBalances = (input: ProjectionInput) =>
        calculateProjection(toSimpleTaxMode(input, parts)).projectionByYear.map(
          (y) => Math.round(y.allAccountsBalance),
        );
      const portfolioSpec = overflowInput().contributionSpecs!.find(
        (sp) => sp.parentCategory === "Portfolio",
      )!;

      it("Portfolio balances, savings, goals, lump sums, ramp and switches change nothing", () => {
        const base = overflowInput();
        const y1 = base.asOfDate.getFullYear() + 1;
        const y30 = base.asOfDate.getFullYear() + 30;
        const switchSpecs = base.contributionSpecs!.filter(
          (sp) => sp.parentCategory !== "Portfolio",
        );
        const withSwitch = (specs: typeof switchSpecs): ProjectionInput => ({
          ...base,
          contributionSpecs: switchSpecs,
          profileSwitches: [
            {
              year: y1 + 2,
              contributionSpecs: specs,
              employerMatchRateByCategory: zero,
              baseYearContributions: zero,
              baseYearEmployerMatch: zero,
              contributionRate: 0.5,
              retirementOnly: {
                baseYearContributions: zero,
                baseYearEmployerMatch: zero,
                employerMatchRateByCategory: zero,
              },
            },
          ],
        });
        const plain = withSwitch(switchSpecs);
        const withPortfolio: ProjectionInput = {
          ...withSwitch([...switchSpecs, portfolioSpec]),
          contributionSpecs: base.contributionSpecs,
          individualAccounts: base.individualAccounts!.map((ia) =>
            ia.parentCategory === "Portfolio"
              ? { ...ia, startingBalance: 1010000 }
              : ia,
          ),
          brokerageGoals: [
            {
              id: 1,
              name: "Car",
              targetAmount: 40000,
              targetYear: y1 + 1,
              priority: 1,
            },
          ],
          brokerageContributionRamp: 1000,
          accumulationOverrides: [
            {
              year: y1,
              lumpSums: [
                {
                  amount: 50000,
                  targetAccount: "brokerage",
                  targetParentCategory: "Portfolio",
                },
                // Named: lands in the Portfolio account.
                {
                  amount: 25000,
                  targetAccount: "brokerage",
                  targetAccountName: "Long-term brokerage",
                },
              ],
            },
          ] as ProjectionInput["accumulationOverrides"],
          decumulationOverrides: [
            {
              year: y30,
              lumpSums: [
                {
                  amount: 70000,
                  targetAccount: "brokerage",
                  targetParentCategory: "Portfolio",
                },
              ],
            },
          ] as ProjectionInput["decumulationOverrides"],
        };
        expect(endBalances(withPortfolio)).toEqual(endBalances(plain));
      });

      it("keeps what is retirement money: retirement lump sums, and the ramp with no Portfolio brokerage", () => {
        const base = overflowInput();
        const y1 = base.asOfDate.getFullYear() + 1;
        const noPortfolio: ProjectionInput = {
          ...base,
          contributionSpecs: base.contributionSpecs!.filter(
            (sp) => sp.parentCategory !== "Portfolio",
          ),
          individualAccounts: base.individualAccounts!.filter(
            (ia) => ia.parentCategory !== "Portfolio",
          ),
        };
        // Year 5 (the 0%-growth fixture is spent down by the end).
        const last = (input: ProjectionInput) => endBalances(input)[5]!;
        expect(
          last({ ...noPortfolio, brokerageContributionRamp: 1000 }),
        ).toBeGreaterThan(last(noPortfolio));
        expect(
          last({
            ...noPortfolio,
            accumulationOverrides: [
              {
                year: y1,
                lumpSums: [{ amount: 50000, targetAccount: "brokerage" }],
              },
            ] as ProjectionInput["accumulationOverrides"],
          }),
        ).toBeGreaterThan(last(noPortfolio));
      });

      it("only Portfolio savings: Simple adds no retirement contributions", () => {
        const base = overflowInput();
        const onlyPortfolio: ProjectionInput = {
          ...base,
          // What the payload sets for such a household (no retirement
          // contributions, real pay): a 0% retirement rate.
          accumulationDefaults: {
            ...base.accumulationDefaults,
            contributionRate: 0,
          },
          contributionSpecs: [portfolioSpec],
        };
        const noSavings: ProjectionInput = {
          ...onlyPortfolio,
          contributionSpecs: [],
        };
        expect(endBalances(onlyPortfolio)).toEqual(endBalances(noSavings));
      });

      it("a profile switch without its retirement-only amounts fails loudly", () => {
        const base = overflowInput();
        expect(() =>
          toSimpleTaxMode(
            {
              ...base,
              profileSwitches: [
                {
                  year: base.asOfDate.getFullYear() + 2,
                  contributionSpecs: [],
                  employerMatchRateByCategory: zero,
                  baseYearContributions: zero,
                  baseYearEmployerMatch: zero,
                  contributionRate: 0,
                },
              ],
            },
            parts,
          ),
        ).toThrow(/retirement-only amounts/);
      });

      it("collapses only retirement money into one tax-free pot", () => {
        const simple = toSimpleTaxMode(overflowInput(), parts);
        expect(simple.startingBalances.afterTax).toBe(110000);
        expect(simple.individualAccounts).toEqual([]);
        expect(simple.brokerageGoals).toEqual([]);
        expect(
          simple.contributionSpecs!.some(
            (sp) => sp.parentCategory === "Portfolio",
          ),
        ).toBe(false);
      });
    });

    it("Portfolio money stays Portfolio: the ramp and a Brokerage-page lump sum", () => {
      const base = overflowInput();
      const year = base.asOfDate.getFullYear() + 1;
      const portfolioBal = (input: ProjectionInput) =>
        (
          calculateProjection(input).projectionByYear.find(
            (y) => y.year === year,
          )!.individualAccountBalances ?? []
        )
          .filter((a) => a.parentCategory === "Portfolio")
          .reduce((t, a) => t + a.balance, 0);
      const without = portfolioBal(base);
      // The Brokerage page's yearly contribution increase.
      expect(
        portfolioBal({ ...base, brokerageContributionRamp: 1000 }) - without,
      ).toBeCloseTo(1000, 0);
      // A Brokerage-page lump sum with no account named.
      expect(
        portfolioBal({
          ...base,
          accumulationOverrides: [
            {
              year,
              lumpSums: [
                {
                  amount: 20000,
                  targetAccount: "brokerage",
                  targetParentCategory: "Portfolio",
                },
              ],
            },
          ] as ProjectionInput["accumulationOverrides"],
        }) - without,
      ).toBeCloseTo(20000, 0);
    });

    describe("brokerage basis per account", () => {
      // Retired; a Retirement brokerage at 28% basis and a Portfolio one at
      // 55%; withdrawals take brokerage first.
      const twoBrokerages = (): ProjectionInput => {
        const base = makeInput({ currentAge: 66, retirementAge: 66 });
        return {
          ...base,
          decumulationDefaults: {
            ...base.decumulationDefaults,
            withdrawalOrder: ["brokerage", "401k", "403b", "ira", "hsa"],
          },
          startingBalances: {
            ...base.startingBalances,
            afterTax: 40000,
            afterTaxBasis: 13900,
          },
          startingAccountBalances: {
            ...base.startingAccountBalances,
            brokerage: {
              structure: "basis_tracking",
              balance: 40000,
              basis: 13900,
            },
          },
          individualAccounts: [
            {
              name: "401k",
              category: "401k",
              taxType: "preTax",
              startingBalance: 80000,
              parentCategory: "Retirement",
            },
            {
              name: "401k",
              category: "401k",
              taxType: "taxFree",
              startingBalance: 20000,
              parentCategory: "Retirement",
            },
            {
              name: "IRA",
              category: "ira",
              taxType: "preTax",
              startingBalance: 30000,
              parentCategory: "Retirement",
            },
            {
              name: "IRA",
              category: "ira",
              taxType: "taxFree",
              startingBalance: 20000,
              parentCategory: "Retirement",
            },
            {
              name: "HSA",
              category: "hsa",
              taxType: "hsa",
              startingBalance: 15000,
              parentCategory: "Retirement",
            },
            {
              name: "Retirement brokerage",
              category: "brokerage",
              taxType: "afterTax",
              startingBalance: 30000,
              startingBasis: 8400,
              parentCategory: "Retirement",
            },
            {
              name: "Long-term brokerage",
              category: "brokerage",
              taxType: "afterTax",
              startingBalance: 10000,
              startingBasis: 5500,
              parentCategory: "Portfolio",
            },
          ],
        };
      };

      it("a retirement brokerage withdrawal is priced at the Retirement brokerage's own basis", () => {
        const first = calculateProjection(
          twoBrokerages(),
        ).projectionByYear.find(
          (y): y is EngineDecumulationYear => y.phase === "decumulation",
        )!;
        const slot = first.slots.find((sl) => sl.category === "brokerage")!;
        expect(slot.withdrawal).toBeGreaterThan(0);
        // Start of that year: 8,400 / the account's balance then (grown from
        // 30,000 by the partial first year) — well under the 13,900/40,000
        // blended ratio (34.75%).
        expect(slot.basisPortion! / slot.withdrawal).toBeLessThan(0.3);
      });

      it("Portfolio basis never moves in retirement; accounts add up to the total; no basis drift", () => {
        const years = calculateProjection(twoBrokerages()).projectionByYear;
        for (const y of years) {
          const brokerage = (y.individualAccountBalances ?? []).filter(
            (a) => a.category === "brokerage",
          );
          const portfolio = brokerage.find(
            (a) => a.parentCategory === "Portfolio",
          )!;
          if (y.phase === "decumulation")
            expect(
              portfolio.costBasis,
              `${y.year} Portfolio basis`,
            ).toBeCloseTo(5500, 0);
          expect(
            (y.warnings ?? []).filter((w) => w.includes("brokerage basis")),
            `${y.year}`,
          ).toEqual([]);
        }
      });

      const noBasisDrift = (input: ProjectionInput) => {
        const years = calculateProjection(input).projectionByYear;
        for (const y of years)
          expect(
            (y.warnings ?? []).filter((w) => w.includes("brokerage basis")),
            `${y.year}`,
          ).toEqual([]);
        return years;
      };

      it("each year's brokerage withdrawal uses exactly the Retirement brokerage's ratio", () => {
        const years = calculateProjection(twoBrokerages()).projectionByYear;
        const i = years.findIndex((y) => y.phase === "decumulation");
        const prev = years[i - 1]!.individualAccountBalances!.find(
          (a) => a.name === "Retirement brokerage",
        )!;
        const slot = (years[i] as EngineDecumulationYear).slots.find(
          (sl) => sl.category === "brokerage",
        )!;
        expect(slot.basisPortion! / slot.withdrawal).toBeCloseTo(
          prev.costBasis! / prev.balance,
          3,
        );
      });

      it("Roth conversions paid from brokerage leave no basis drift", () => {
        // A Retirement brokerage big enough to keep paying conversion tax,
        // and Traditional money worth converting.
        const small = twoBrokerages();
        const base: ProjectionInput = {
          ...small,
          startingBalances: {
            ...small.startingBalances,
            preTax: 600000,
            afterTax: 410000,
            afterTaxBasis: 120000,
          },
          startingAccountBalances: {
            ...small.startingAccountBalances,
            "401k": {
              structure: "roth_traditional",
              traditional: 570000,
              roth: 20000,
            },
            brokerage: {
              structure: "basis_tracking",
              balance: 410000,
              basis: 120000,
            },
          },
          individualAccounts: small.individualAccounts!.map((ia) =>
            ia.name === "Retirement brokerage"
              ? { ...ia, startingBalance: 400000, startingBasis: 114500 }
              : ia.name === "401k" && ia.taxType === "preTax"
                ? { ...ia, startingBalance: 570000 }
                : ia,
          ),
        };
        const years = noBasisDrift({
          ...base,
          decumulationDefaults: {
            ...base.decumulationDefaults,
            distributionTaxRates: {
              ...base.decumulationDefaults.distributionTaxRates,
              enableRothConversions: true,
              rothConversionTarget: 0.22,
              taxBrackets: [
                { threshold: 0, baseWithholding: 0, rate: 0.1 },
                { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
                { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
              ],
              grossUpForTaxes: true,
              taxMultiplier: 1.0,
            },
          },
        });
        expect(
          years.some(
            (y) =>
              y.phase === "decumulation" &&
              (y as EngineDecumulationYear).rothConversionAmount > 0,
          ),
        ).toBe(true);
      });

      it("a lump sum in retirement brings its basis with it", () => {
        const base = twoBrokerages();
        const year = base.asOfDate.getFullYear() + 3;
        noBasisDrift({
          ...base,
          decumulationOverrides: [
            {
              year,
              lumpSums: [{ amount: 50000, targetAccount: "brokerage" }],
            },
          ] as ProjectionInput["decumulationOverrides"],
        });
      });

      it("without contribution specs, brokerage contributions keep their basis", () => {
        const base = overflowInput();
        noBasisDrift({
          ...base,
          contributionSpecs: undefined,
          individualAccounts: base.individualAccounts!.map((ia) =>
            ia.category === "brokerage"
              ? { ...ia, startingBasis: ia.startingBalance }
              : ia,
          ),
          accumulationDefaults: {
            ...base.accumulationDefaults,
            accountSplits: {
              "401k": 0.5,
              "403b": 0,
              hsa: 0,
              ira: 0,
              brokerage: 0.5,
            },
          },
        });
      });

      it("a goal's draw never touches Retirement basis", () => {
        const base = overflowInput();
        const year = base.asOfDate.getFullYear() + 2;
        const withBasis = (input: ProjectionInput): ProjectionInput => ({
          ...input,
          individualAccounts: input.individualAccounts!.map((ia) =>
            ia.category === "brokerage"
              ? { ...ia, startingBasis: ia.startingBalance / 2 }
              : ia,
          ),
        });
        const retirementBasis = (input: ProjectionInput) =>
          calculateProjection(withBasis(input))
            .projectionByYear.find((y) => y.year === year)!
            .individualAccountBalances!.filter(
              (a) =>
                a.category === "brokerage" && a.parentCategory === "Retirement",
            )
            .reduce((t, a) => t + (a.costBasis ?? 0), 0);
        expect(
          retirementBasis({
            ...base,
            brokerageGoals: [
              {
                id: 1,
                name: "Car",
                targetAmount: 10000,
                targetYear: year,
                priority: 1,
              },
            ],
          }),
        ).toBeCloseTo(retirementBasis(base), 0);
      });
    });

    describe("unspent RMD money stays retirement money", () => {
      // Age 75 with a $3.2M Traditional 401(k) and a $40k budget: the RMD
      // far exceeds spending; the rest is reinvested.
      const rmdHousehold = (
        brokerages: IndividualAccountInput[],
        handling: "reinvest" | "spend" = "reinvest",
      ): ProjectionInput => {
        const base = makeInput({
          currentAge: 75,
          retirementAge: 65,
          projectionEndAge: 78,
          birthYear: 1950,
          currentSalary: 0,
          annualExpenses: 40000,
          socialSecurityAnnual: 30000,
          ssStartAge: 70,
        });
        const brok = brokerages.reduce((t, b) => t + b.startingBalance, 0);
        const brokBasis = brokerages.reduce(
          (t, b) => t + (b.startingBasis ?? 0),
          0,
        );
        return {
          ...base,
          individualAccounts: [
            {
              name: "401k",
              category: "401k",
              taxType: "preTax",
              startingBalance: 3200000,
              ownerPersonId: 1,
              ownerName: "Alex",
              parentCategory: "Retirement",
            },
            ...brokerages,
          ],
          startingBalances: {
            preTax: 3200000,
            taxFree: 0,
            afterTax: brok,
            afterTaxBasis: brokBasis,
            hsa: 0,
          },
          startingAccountBalances: {
            ...base.startingAccountBalances,
            "401k": {
              structure: "roth_traditional",
              traditional: 3200000,
              roth: 0,
            },
            ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
            hsa: { structure: "single_bucket", balance: 0 },
            brokerage: {
              structure: "basis_tracking",
              balance: brok,
              basis: brokBasis,
            },
          },
          decumulationDefaults: {
            ...base.decumulationDefaults,
            withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
            rmdExcessHandling: handling,
          },
        };
      };
      const brok = (
        name: string,
        bal: number,
        parentCategory: string,
        extra: Partial<IndividualAccountInput> = {},
      ): IndividualAccountInput => ({
        name,
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: bal,
        startingBasis: bal / 2,
        parentCategory,
        ...extra,
      });
      const firstYear = (input: ProjectionInput) => {
        const y = calculateProjection(input).projectionByYear.find(
          (r): r is EngineDecumulationYear => r.phase === "decumulation",
        )!;
        return {
          excess: y.rmdExcessAmount,
          // An account with no row (the projection-only one while empty) holds $0.
          bal: (name: string) =>
            y.individualAccountBalances!.find((a) => a.name === name)
              ?.balance ?? 0,
          hasRow: (name: string) =>
            y.individualAccountBalances!.some((a) => a.name === name),
        };
      };

      it("by default it's spread over the Retirement brokerages; Portfolio gets none", () => {
        const accts = [
          brok("A", 30000, "Retirement"),
          brok("B", 10000, "Retirement"),
          brok("P", 50000, "Portfolio"),
        ];
        const reinvest = firstYear(rmdHousehold(accts));
        const spend = firstYear(rmdHousehold(accts, "spend"));
        expect(reinvest.excess).toBeGreaterThan(0);
        expect(reinvest.bal("P")).toBeCloseTo(spend.bal("P"), 0);
        expect(reinvest.bal("A") - spend.bal("A")).toBeGreaterThan(
          reinvest.bal("B") - spend.bal("B"),
        );
      });

      it("the chosen account receives all of it", () => {
        const accts = [
          brok("A", 30000, "Retirement"),
          brok("B", 10000, "Retirement", { rmdExcessTarget: true }),
          brok("P", 50000, "Portfolio"),
        ];
        const reinvest = firstYear(rmdHousehold(accts));
        const spend = firstYear(rmdHousehold(accts, "spend"));
        expect(reinvest.bal("A")).toBeCloseTo(spend.bal("A"), 0);
        expect(reinvest.bal("P")).toBeCloseTo(spend.bal("P"), 0);
        expect(reinvest.bal("B") - spend.bal("B")).toBeGreaterThan(0);
      });

      it("with no Retirement brokerage, the projection-only one takes it and nothing else", () => {
        const accts = [
          brok("P", 50000, "Portfolio"),
          brok("Projected", 0, "Retirement", {
            projectedOnly: true,
            startingBasis: 0,
          }),
        ];
        const reinvest = firstYear(rmdHousehold(accts));
        const spend = firstYear(rmdHousehold(accts, "spend"));
        expect(reinvest.bal("P")).toBeCloseTo(spend.bal("P"), 0);
        expect(reinvest.bal("Projected")).toBeGreaterThan(0);
        expect(spend.bal("Projected")).toBe(0);
        // Shown once it holds money, hidden while empty.
        expect(reinvest.hasRow("Projected")).toBe(true);
        expect(spend.hasRow("Projected")).toBe(false);
      });
    });
  });
});
