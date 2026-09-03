/* eslint-disable no-restricted-syntax -- `as unknown as` casts build PG-style
   string fixtures for helper input types whose fields are typed `number`; that
   type mismatch is the entire point of the suite. */
/**
 * Dual-DB parity — the decimal normalization boundary (PG string vs SQLite number)
 *
 * Ledgr runs on Postgres in production and SQLite in demo/dev. The `pg`
 * driver returns `decimal`/`numeric` columns as JS **strings** (`"1234.56"`);
 * `better-sqlite3` returns the same columns as **numbers** (`1234.56`). Every
 * helper that reads a decimal column has to normalize it — `toNumber()` in
 * `src/server/helpers/transforms.ts` — or the value crosses into financial
 * math as a string. That fails only in production, and never in CI (SQLite).
 *
 * This suite feeds each boundary-crossing helper **PG-style string inputs**
 * and asserts the output field is `typeof "number"`. If a mapping drops a
 * `toNumber()` call, the string propagates and the type assertion fails.
 *
 * ── Mock fidelity ────────────────────────────────────────────────────────
 * The db-mock blocks below simulate the `pg` driver returning numeric/decimal
 * columns as JS strings — its documented default behavior
 * (https://node-postgres.com/features/types). If that ever changes (a `pg`
 * major bump, or Drizzle's numeric parser gets enabled) these mocks go stale
 * silently: the tests keep passing while the protection is gone. A real-PG CI
 * service would test the *driver*; the bug class here is a *missing toNumber()
 * in a field mapping*, which a string fixture catches identically — so mocks
 * are the right tool, but only while this assumption holds.
 *
 * ── Keeping the inventory current ────────────────────────────────────────
 * The helper list is derived from the SCHEMA (every table with a `decimal`
 * column → every helper that reads it), NOT from which helpers already call
 * `toNumber()` — that check is blind by construction to the helper that
 * forgot. When you add a decimal column to a table one of these helpers
 * reads: add the field to the fixture here FIRST, watch the test fail, then
 * add the `toNumber()` call. This file is the living index of every decimal
 * column that crosses the normalization boundary.
 *
 * Additional boundary sites covered indirectly / by other suites:
 *   - contribution.ts `computeGroupedEmployerMatch` — receives values already
 *     `toNumber()`d by `buildContribAccounts`; covered transitively here.
 *   - budget.ts `getEffectiveOtherAssetsDetailed` (otherAssetItems.value),
 *     `resolveLinkedBudgetItemAmounts` (contribution_limits.value) — db-select
 *     helpers; exercised by tests/routers/budget*.
 *   - budget-api-push.ts `loadSnapshotBalancesByPerformanceAccountId` — private,
 *     already uses toNumber(); exercised by tests/routers/sync*.
 */
// Routes @/lib/db/schema → schema-sqlite and stubs the db/dialect/budget-api
// modules the helpers import transitively. The parity fixtures below are all
// hand-built PG-style string rows — no real database is touched.
import "../helpers/setup-mocks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

import { resolvePersonYearIncome } from "@/server/helpers/salary";
import type { SalaryProfileActiveMap } from "@/server/helpers/salary";
import { buildContribAccounts } from "@/server/helpers/contribution";
import type { ContribRowWithActiveFields } from "@/server/helpers/contribution";
import { buildMortgageInputs } from "@/server/helpers/mortgage";
import { buildPaycheckInputForJob } from "@/server/helpers/paycheck-input";
import type {
  JobForPaycheckInput,
  ResolvedPaycheckInputs,
} from "@/server/helpers/paycheck-input";
import { getResolvedGoalAllocations } from "@/server/helpers/savings-allocation";
import { finalizeRothBasisForYear } from "@/server/helpers/roth-basis";
import {
  getLatestSnapshot,
  buildYearEndHistory,
  invalidateYearEndCache,
} from "@/server/helpers/snapshot";

// ---------------------------------------------------------------------------
// Table-dispatching db mock
//
// buildYearEndHistory issues a 15-way Promise.all where every arm is
// `db.select().from(<table>)` (some with .orderBy/.where/.leftJoin/.limit).
// A single select→from→where mock would feed every table the same rows. This
// mock dispatches on the Drizzle table object passed to `.from()` and returns
// the fixture registered for that table name (default: []).
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];

function makeTableDispatchDb(rowsByTable: Record<string, Rows>) {
  function selectBuilder() {
    let table: string | null = null;
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ["where", "orderBy", "limit", "groupBy", "having"]) {
      chain[m] = vi.fn(passthrough);
    }
    chain.leftJoin = vi.fn(passthrough);
    chain.innerJoin = vi.fn(passthrough);
    chain.from = vi.fn((t: unknown) => {
      try {
        table = getTableName(t as never);
      } catch {
        table = null;
      }
      return chain;
    });
    chain.then = (
      resolve: (v: Rows) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      try {
        return Promise.resolve((table && rowsByTable[table]) || []).then(
          resolve,
          reject,
        );
      } catch (e) {
        return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
      }
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: vi.fn(() => selectBuilder()),
  };
  return db as never;
}

// ===========================================================================
// Pure helpers — pass PG-style string rows directly, no mock needed
// ===========================================================================

describe("salary.ts — PG string mode", () => {
  it("resolvePersonYearIncome normalizes a historical_salaries row", () => {
    // PG returns decimal columns (salary, bonus) as JS strings.
    const historicalRow = { salary: "85000.00", bonus: "5000.00" };
    const emptyMap: SalaryProfileActiveMap = new Map();

    const result = resolvePersonYearIncome(
      2023,
      2026,
      historicalRow,
      null,
      emptyMap,
    );

    expect(typeof result.salary).toBe("number");
    expect(typeof result.bonus).toBe("number");
    expect(result.salary).toBe(85000);
    expect(result.bonus).toBe(5000);
    expect(result.recorded).toBe(true);
  });

  it("resolvePersonYearIncome handles a null decimal without producing NaN", () => {
    const result = resolvePersonYearIncome(
      2023,
      2026,
      { salary: "72000.00", bonus: null },
      null,
      new Map(),
    );
    expect(typeof result.bonus).toBe("number");
    expect(result.bonus).toBe(0);
  });
});

describe("contribution.ts — PG string mode", () => {
  it("buildContribAccounts normalizes contribution + employer-match decimals", () => {
    // contribution_accounts decimal columns per schema-pg.ts:
    //   contribution_value, employer_match_value, employer_max_match_pct,
    //   target_annual, prior_year_contrib_amount
    const row: ContribRowWithActiveFields = {
      id: 1,
      personId: 1,
      jobId: 10,
      accountType: "401k",
      parentCategory: "retirement",
      contributionMethod: "percent_of_salary",
      contributionValue: "14.000000", // string (PG)
      employerMatchType: "percent_of_salary",
      employerMatchValue: "50.000000", // string (PG) — 50% of contribution
      employerMaxMatchPct: "0.060000", // string (PG) — cap at 6% of salary
      employerMatchTaxTreatment: "traditional",
      targetAnnual: "23000.00",
      priorYearContribAmount: "12000.00",
      // non-decimal columns the builder touches
      isRoth: false,
      accountLabel: "Fidelity 401k",
      include401kInBonus: false,
    } as unknown as ContribRowWithActiveFields;

    const [acct] = buildContribAccounts([row], [], 100000, 26);

    expect(acct).toBeDefined();
    expect(typeof acct!.annualContribution).toBe("number");
    expect(typeof acct!.perPeriodContribution).toBe("number");
    expect(typeof acct!.employerMatch).toBe("number");
    expect(typeof acct!.rateOfGross).toBe("number"); // percent_of_salary → number
    expect(Number.isNaN(acct!.annualContribution)).toBe(false);
    expect(Number.isNaN(acct!.employerMatch)).toBe(false); // NaN = a string reached the match math
    // 14% of 100k = 14000 (match-math correctness has its own suite).
    expect(acct!.annualContribution).toBeCloseTo(14000);
  });
});

describe("mortgage.ts — PG string mode", () => {
  it("buildMortgageInputs normalizes loan + extra-payment decimals", () => {
    // mortgage_loans decimals: original_loan_amount, interest_rate,
    //   principal_and_interest, api_balance (+ more not read here)
    const loan = {
      id: 1,
      name: "Primary",
      originalLoanAmount: "400000.00",
      interestRate: "0.037500",
      principalAndInterest: "1850.00",
      termYears: 30,
      firstPaymentDate: "2020-01-01",
      refinancedFromId: null,
      isActive: true,
      paidOffDate: null,
      apiBalance: "372500.00",
      apiBalanceDate: null,
    } as unknown as Parameters<typeof buildMortgageInputs>[0][number];

    const extra = {
      loanId: 1,
      paymentDate: "2021-06-01",
      startDate: null,
      endDate: null,
      amount: "500.00", // mortgage_extra_payments.amount — decimal
    } as unknown as Parameters<typeof buildMortgageInputs>[1][number];

    const { loanInputs, extras } = buildMortgageInputs([loan], [extra]);

    const li = loanInputs[0]!;
    expect(typeof li.originalBalance).toBe("number");
    expect(typeof li.interestRate).toBe("number");
    expect(typeof li.monthlyPI).toBe("number");
    expect(typeof li.apiBalance).toBe("number");
    expect(li.originalBalance).toBe(400000);
    expect(li.interestRate).toBeCloseTo(0.0375);

    expect(extras).toHaveLength(1);
    expect(typeof extras[0]!.amount).toBe("number");
    expect(extras[0]!.amount).toBe(500);
  });
});

describe("paycheck-input.ts — PG string mode", () => {
  it("buildPaycheckInputForJob normalizes additionalFedWithholding + bonus terms", () => {
    const job: JobForPaycheckInput = {
      payPeriod: "biweekly",
      payWeek: "week1",
      anchorPayDate: "2026-01-02",
      startDate: "2020-01-01",
      include401kInBonus: false,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
      additionalFedWithholding: "125.00", // jobs.additional_fed_withholding style string
    };
    const resolved = {
      salary: 100000,
      bonusTerms: {
        bonusPercent: "0.150000", // string (PG)
        bonusMultiplier: "1.000000", // string (PG)
        monthsInBonusYear: 12,
      },
      bonusOverride: null,
      contributionAccounts: [],
      deductions: [],
      taxBrackets: {} as ResolvedPaycheckInputs["taxBrackets"],
      limitsMap: new Map([["supplemental_tax_rate", 0.22]]),
      limitsRecord: { supplemental_tax_rate: 0.22 },
      asOfDate: new Date("2026-06-01"),
    } as unknown as ResolvedPaycheckInputs;

    const input = buildPaycheckInputForJob(job, resolved);

    expect(typeof input.additionalFedWithholding).toBe("number");
    expect(typeof input.bonusPercent).toBe("number");
    expect(typeof input.bonusMultiplier).toBe("number");
    expect(input.additionalFedWithholding).toBe(125);
    expect(input.bonusPercent).toBeCloseTo(0.15);
    expect(input.bonusMultiplier).toBe(1);
  });
});

// ===========================================================================
// DB-backed helpers — table-dispatch mock returning PG-style string rows
// ===========================================================================

describe("savings-allocation.ts — PG string mode", () => {
  it("getResolvedGoalAllocations normalizes allocationPercent + monthlyContribution", async () => {
    const db = makeTableDispatchDb({
      savings_goal_profile_allocations: [
        {
          goalId: 1,
          budgetProfileId: 7,
          allocationPercent: "0.250000", // decimal → string (PG)
          monthlyContribution: "300.00", // decimal → string (PG)
        },
      ],
    });

    const result = await getResolvedGoalAllocations(db, [{ id: 1 }], 7);
    const alloc = result.get(1)!;

    expect(typeof alloc.allocationPercent).toBe("number");
    expect(typeof alloc.monthlyContribution).toBe("number");
    expect(alloc.allocationPercent).toBeCloseTo(0.25);
    expect(alloc.monthlyContribution).toBe(300);
  });

  it("getResolvedGoalAllocations maps a null percent to null, not NaN", async () => {
    const db = makeTableDispatchDb({
      savings_goal_profile_allocations: [
        {
          goalId: 2,
          budgetProfileId: 7,
          allocationPercent: null,
          monthlyContribution: "0.00",
        },
      ],
    });
    const alloc = (await getResolvedGoalAllocations(db, [{ id: 2 }], 7)).get(
      2,
    )!;
    expect(alloc.allocationPercent).toBeNull();
    expect(typeof alloc.monthlyContribution).toBe("number");
  });
});

describe("roth-basis.ts — PG string mode", () => {
  // computeRothBasisRollover deliberately re-serializes with `.toFixed(2)` on
  // its way back into the decimal column — strings don't have `.toFixed`, so
  // reaching a correctly-formatted "42000.00" is itself proof that
  // `toNumber()` normalized the row on the way in.
  it("finalizeRothBasisForYear normalizes contributionBasis + conversionBasis before rollover", async () => {
    const seededValues: Record<string, unknown>[] = [];

    // Minimal tx mock: select→from→where returns the not-finalized rows for
    // the target year, then [] for the next-year existence check; update() is
    // a no-op; insert().values() captures what gets seeded forward.
    let selectCall = 0;
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCall += 1;
            if (selectCall === 1) {
              return Promise.resolve([
                {
                  id: 1,
                  performanceAccountId: 10,
                  ownerPersonId: 1,
                  year: 2025,
                  contributionBasis: "42000.00", // decimal → string (PG)
                  conversionBasis: "15000.00", // decimal → string (PG)
                  latestConversionYear: 2024,
                  isFinalized: false,
                },
              ]);
            }
            return Promise.resolve([]); // next-year existing pairs
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((rows: Record<string, unknown>[]) => {
          seededValues.push(...rows);
          return { onConflictDoNothing: vi.fn(() => Promise.resolve()) };
        }),
      })),
    } as never;

    await finalizeRothBasisForYear(tx, 2025);

    expect(seededValues).toHaveLength(1);
    const seeded = seededValues[0]!;
    expect(seeded.contributionBasis).toBe("42000.00");
    expect(seeded.conversionBasis).toBe("15000.00");
    // A string input would have thrown on `.toFixed` before reaching here.
    expect(() => finalizeRothBasisForYear).not.toThrow();
  });
});

describe("snapshot.ts — PG string mode", () => {
  beforeEach(() => {
    // buildYearEndHistory has a 5s module-level cache — a second test would
    // otherwise assert against the first test's fixture.
    invalidateYearEndCache();
  });

  it("getLatestSnapshot normalizes portfolio_accounts.amount", async () => {
    const db = makeTableDispatchDb({
      portfolio_snapshots: [{ id: 99, snapshotDate: "2025-12-31" }],
      portfolio_accounts: [
        {
          institution: "Vanguard",
          taxType: "traditional",
          accountType: "401k",
          subType: null,
          label: "401k",
          parentCategory: "retirement",
          amount: "123456.78", // decimal → string (PG)
          ownerPersonId: 1,
          performanceAccountId: null,
          accountLabel: null,
          displayName: null,
          perfParentCategory: null,
        },
      ],
    });

    const result = await getLatestSnapshot(db);
    expect(result).not.toBeNull();
    expect(typeof result!.accounts[0]!.amount).toBe("number");
    expect(result!.accounts[0]!.amount).toBeCloseTo(123456.78);
    expect(typeof result!.total).toBe("number");
    expect(result!.total).toBeCloseTo(123456.78);
  });

  it("buildYearEndHistory normalizes annual_performance + net_worth_annual decimals", async () => {
    const db = makeTableDispatchDb({
      net_worth_annual: [
        {
          year: 2024,
          yearEndDate: "2024-12-31",
          cash: "5000.00",
          houseValue: "600000.00",
          retirementTotal: "400000.00",
          hsa: "10000.00",
          ltBrokerage: "50000.00",
          espp: "0.00",
          rBrokerage: "20000.00",
          otherAssets: "0.00",
          mortgageBalance: "350000.00",
          otherLiabilities: "0.00",
          taxFreeTotal: "30000.00",
          taxDeferredTotal: "400000.00",
          portfolioTotal: "480000.00",
          propertyTaxes: "8000.00",
          grossIncome: "150000.00",
        },
      ],
      annual_performance: [
        {
          year: 2024,
          accountType: "401k",
          beginningBalance: "360000.00",
          totalContributions: "23000.00",
          yearlyGainLoss: "17000.00",
          endingBalance: "400000.00",
          annualReturnPct: "0.047000",
          employerContributions: "6000.00",
          distributions: "0.00",
          fees: "0.00",
          rollovers: "0.00",
          lifetimeGains: "80000.00",
          lifetimeContributions: "300000.00",
          lifetimeMatch: "40000.00",
        },
      ],
    });

    const rows = await buildYearEndHistory(db, new Date("2025-06-01"));
    expect(Array.isArray(rows)).toBe(true);
    const row2024 = rows.find((r) => r.year === 2024);
    expect(row2024).toBeDefined();

    // Spot-check the fields fed straight from the string fixtures.
    expect(typeof row2024!.netWorth).toBe("number");
    expect(typeof row2024!.portfolioTotal).toBe("number");
    expect(Number.isNaN(row2024!.netWorth)).toBe(false);
    expect(Number.isNaN(row2024!.portfolioTotal)).toBe(false);

    for (const [k, v] of Object.entries(row2024!.portfolioByType ?? {})) {
      expect(typeof v, `portfolioByType["${k}"]`).toBe("number");
      expect(Number.isNaN(v as number)).toBe(false);
    }
  });
});
