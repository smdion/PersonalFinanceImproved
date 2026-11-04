/**
 * Answer key, the engine payload: cases whose fault is in the server's
 * build of the engine input (`src/server/retirement/build-engine-payload.ts`
 * and the helpers it calls), so they're run through it on a seeded test
 * database, then (where the figure is a projected one) through
 * `calculateProjection`. Sources: the November review's
 * `rebuild/engine-verdicts.md` (E8, S1) and `spending-terms-trace.md`
 * (T4, T6), as collected in the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Engine, and § "Re-run on
 * `24bae33b`": E8 fails in the server cap pass, so the engine alone, fed
 * 36,000, passes).
 *
 * Households are invented and seeded here. The clock and the snapshot
 * (the payload's as-of date) are 2026-01-01, so 2026 is a whole year and
 * the 2026 tax file applies; one return rate, 5%, at every age.
 *
 * The Retirement budget's settings live in `app_settings` today, read only
 * by the client (`use-plan-engine-input.ts`); the decided fix moves them
 * onto the Retirement Profile with a migration, so T4's seed moves with
 * that fix.
 */
import "../routers/setup-mocks";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  vi,
} from "vitest";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import { calculateProjection } from "@/lib/calculators/engine";
import { buildDecumulationDefaults } from "@/server/routers/projection/_shared";
import { SK_RETIREMENT_DEC_EXPENSE_OVERRIDE } from "@/lib/constants/settings-keys";
import { xfail } from "../fixtures/answer-key";
import {
  createTestCaller,
  seedAppSetting,
  seedBudgetItem,
  seedBudgetProfile,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerformanceAccount,
} from "../routers/setup";
import type { Db } from "@/lib/db";

type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

const ONE_RESOLVER = `v0.11 Engine "One server resolver for the Retirement budget" (decision: one server-side resolver every screen uses)`;
const OVER_LIMIT = `v0.11 Engine "Plan 'to 95' stops at 94" (its over-limit part, decision C4: overflow to a Retirement brokerage in every year)`;
const SPEC_TO_ACCOUNT = `v0.11 Engine "matchAccountForContribution matches by owner name" (join specs to accounts by performance account id)`;

/** The household's Projection, from the payload as a router runs it (the
 *  saved decumulation settings, no client overrides, no changes by year). */
async function projectFromPayload(appDb: Db, contributionProfileId: number) {
  const data = await fetchRetirementData(appDb, { contributionProfileId });
  const payload = (await buildEnginePayload(appDb, data, {
    contributionProfileId,
  }))!;
  return calculateProjection({
    ...payload.baseEngineInput,
    decumulationDefaults: buildDecumulationDefaults(
      payload.settings,
      { withdrawalTaxPreference: {} },
      payload.distributionTaxRates,
    ),
    accumulationOverrides: [],
    decumulationOverrides: [],
  }).projectionByYear;
}

/** A test database; each test fixes the clock at 2026-01-01. */
async function freshDb(): Promise<{
  db: SqliteDb;
  appDb: Db;
  cleanup: () => void;
}> {
  const ctx = await createTestCaller();
  // One return rate, 5% at every age (the Projection needs one).
  ctx.db
    .insert(sqliteSchema.returnRateTable)
    .values({ age: 0, rateOfReturn: "0.05" })
    .run();
  return { db: ctx.db, appDb: ctx.rawDb, cleanup: ctx.cleanup };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

/** A person with a Retirement settings row; the first is primary. */
function person(
  db: SqliteDb,
  name: string,
  dateOfBirth: string,
  primary: boolean,
): number {
  const id = db
    .insert(sqliteSchema.people)
    .values({ name, dateOfBirth, isPrimaryUser: primary })
    .returning({ id: sqliteSchema.people.id })
    .get().id;
  db.insert(sqliteSchema.retirementSettings)
    .values({
      personId: id,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.04",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "0",
      ssStartAge: 67,
      filingStatus: "Single",
    })
    .run();
  return id;
}

/** One account in a snapshot dated 2026-01-01 (the payload's as-of date is the latest snapshot's). */
function holding(
  db: SqliteDb,
  a: {
    ownerPersonId: number;
    accountType: string;
    parentCategory: "Retirement" | "Portfolio";
    taxType: "preTax" | "taxFree" | "afterTax";
    amount: number;
    label: string;
  },
): number {
  const perfId = seedPerformanceAccount(db, {
    accountType: a.accountType,
    parentCategory: a.parentCategory,
    ownerPersonId: a.ownerPersonId,
    accountLabel: a.label,
  });
  const snap =
    db.select().from(sqliteSchema.portfolioSnapshots).get() ??
    db
      .insert(sqliteSchema.portfolioSnapshots)
      .values({ snapshotDate: "2026-01-01" })
      .returning()
      .get();
  db.insert(sqliteSchema.portfolioAccounts)
    .values({
      snapshotId: snap.id,
      performanceAccountId: perfId,
      amount: String(a.amount),
      taxType: a.taxType,
      institution: "Fidelity",
      accountType: a.accountType,
      parentCategory: a.parentCategory,
      ownerPersonId: a.ownerPersonId,
    })
    .run();
  return perfId;
}

/** A Contribution Profile giving each account a fixed amount a year. */
function fixedContributions(
  db: SqliteDb,
  annual: Record<number, number>,
): number {
  const contributionAccounts = Object.fromEntries(
    Object.entries(annual).map(([id, v]) => [
      id,
      { contributionValue: String(v), contributionMethod: "fixed_annual" },
    ]),
  );
  return seedContributionProfile(db, {
    name: "Answer key",
    contributionActiveFields: { contributionAccounts, jobs: {} },
  });
}

describe("answer key: the Retirement budget every screen runs on (spending-terms trace)", () => {
  // One person, born 1965, a $150,000 job and a 401(k) of 500,000. Budget
  // 10,000 a month = 120,000 a year (the active Budget profile, one
  // column).
  let db: SqliteDb;
  let appDb: Db;
  let cleanup: () => void;
  let budgetProfileId: number;

  beforeAll(async () => {
    ({ db, appDb, cleanup } = await freshDb());
    const id = person(db, "Alex", "1965-06-15", true);
    seedJob(db, id, { annualSalary: "150000", startDate: "2010-01-01" });
    holding(db, {
      ownerPersonId: id,
      accountType: "401k",
      parentCategory: "Retirement",
      taxType: "preTax",
      amount: 500_000,
      label: "Alex 401k",
    });
    budgetProfileId = await seedBudgetProfile(db, "Answer key budget");
    for (const p of db.select().from(sqliteSchema.budgetProfiles).all())
      if (p.id !== budgetProfileId)
        db.update(sqliteSchema.budgetProfiles)
          .set({ isActive: false })
          .where(eq(sqliteSchema.budgetProfiles.id, p.id))
          .run();
    seedBudgetItem(db, budgetProfileId, {
      category: "Essentials",
      subcategory: "Everything",
      amounts: [10_000],
    });
  });
  afterAll(() => cleanup());

  /** What the payload sends, and the Retirement budget the engine then
   *  spends from (`decumulationAnnualExpenses ?? annualExpenses`). */
  const sent = (input: {
    decumulationAnnualExpenses?: number;
    annualExpenses: number;
  }) => ({
    decumulationAnnualExpenses: input.decumulationAnnualExpenses ?? NaN,
    retirementBudget: input.decumulationAnnualExpenses ?? input.annualExpenses,
  });

  describe("engine/T4", () => {
    // Trace #2: the Retirement budget is set to an amount, 90,000 (the
    // Retirement page's setting, `retirement_dec_expense_override`). The
    // Tax Optimization tabs, Tax Buckets "At Retirement", Brokerage, the
    // Social Security explorer, Plan Health and Relocation build the
    // payload without forwarding it. Decided: one server-side resolver, so
    // each gets `decumulationAnnualExpenses` 90,000. Today the payload
    // falls back to the Budget, 120,000: 30,000 a year more spending in
    // retirement than the Retirement page shows.
    xfail({
      id: "engine/T4 [ENG-03]",
      todo: ONE_RESOLVER,
      run: async () => {
        db.delete(sqliteSchema.appSettings)
          .where(
            eq(
              sqliteSchema.appSettings.key,
              SK_RETIREMENT_DEC_EXPENSE_OVERRIDE,
            ),
          )
          .run();
        seedAppSetting(db, SK_RETIREMENT_DEC_EXPENSE_OVERRIDE, "90000");
        const data = await fetchRetirementData(appDb, {});
        const payload = await buildEnginePayload(appDb, data, {});
        return sent(payload!.baseEngineInput);
      },
      expected: {
        decumulationAnnualExpenses: 90_000,
        retirementBudget: 90_000,
      },
      today: { retirementBudget: 120_000 },
    });
  });

  describe("engine/T6", () => {
    // Trace #6: a Retirement budget picked as the same Budget profile and
    // column, so its total equals the Budget's (120,000). Decided (the
    // trace's fix, under the one resolver): it is always sent, so Coast
    // FIRE's need test runs. Today the payload
    // omits it when the two totals are equal
    // (`build-engine-payload.ts:1262-1267`).
    xfail({
      id: "engine/T6 [ENG-03]",
      todo: ONE_RESOLVER,
      run: async () => {
        const data = await fetchRetirementData(appDb, {});
        const payload = await buildEnginePayload(appDb, data, {
          decumulationBudgetProfileId: budgetProfileId,
          decumulationBudgetColumn: 0,
        });
        const input = payload!.baseEngineInput;
        return {
          ...sent(input),
          sent: input.decumulationAnnualExpenses === undefined ? 0 : 1,
        };
      },
      expected: {
        sent: 1,
        decumulationAnnualExpenses: 120_000,
        retirementBudget: 120_000,
      },
      today: { sent: 0, retirementBudget: 120_000 },
    });
  });
});

describe("answer key: over-limit money overflows (verdict E8, decision C4)", () => {
  // Single, born 1979 (47 in 2026, no catch-up), a $130,000 job, a Roth
  // 401(k) (balance 100,000) set to a fixed 36,000 a year. The 2026
  // 401(k) employee limit is 24,500 (`401k_employee_limit`, IRS Notice
  // 2025-67). Decided (C4, DESIGN § Account Categories, retirement scope: "contribution
  // overflow … go to Retirement brokerages"): 24,500 to the 401(k) and
  // 36,000 − 24,500 = 11,500 to a Retirement brokerage, every year. Today
  // the server's cap pass (`contribution-caps.ts:206`) sends the spec as
  // 24,500, so 2026 overflow is 0 and the 11,500 is neither saved nor
  // overflowed (verdict E8; key § Re-run).
  describe("engine/E8", () => {
    xfail({
      id: "engine/E8 [ENG-12]",
      todo: OVER_LIMIT,
      run: async () => {
        const { db, appDb, cleanup } = await freshDb();
        try {
          const id = person(db, "Alex", "1979-06-15", true);
          const jobId = seedJob(db, id, {
            annualSalary: "130000",
            startDate: "2010-01-01",
          });
          const perf = holding(db, {
            ownerPersonId: id,
            accountType: "401k",
            parentCategory: "Retirement",
            taxType: "taxFree",
            amount: 100_000,
            label: "Alex Roth 401k",
          });
          const acct = seedContributionAccount(db, {
            personId: id,
            jobId,
            accountType: "401k",
            parentCategory: "Retirement",
            taxTreatment: "tax_free",
            performanceAccountId: perf,
          });
          const contributionProfileId = fixedContributions(db, {
            [acct]: 36_000,
          });
          const y = (
            await projectFromPayload(appDb, contributionProfileId)
          ).find((r) => r.year === 2026)!;
          if (y.phase !== "accumulation") throw new Error("2026 isn't working");
          return {
            toThe401k: y.totalEmployee,
            overflow: y.overflowToBrokerage,
          };
        } finally {
          cleanup();
        }
      },
      expected: { toThe401k: 24_500, overflow: 11_500 },
      today: { toThe401k: 24_500, overflow: 0 },
    });
  });
});

describe("answer key: Retirement money when one person funds the other's Portfolio account (verdict S1)", () => {
  // Two people. A (born 1975) has a $100,000 job and a 401(k) of 300,000;
  // A also owns a Portfolio brokerage (50,000, all basis). B (born 1977)
  // has an $80,000 job and saves a fixed 2,428 a year into A's Portfolio
  // brokerage. DESIGN § Account Categories, retirement scope: Retirement money is the
  // Retirement-parented accounts, so `retirementBalance` must equal their
  // sum every year (EY-SC-06), and the Portfolio account shows the 2,428.
  // Today `matchAccountForContribution` (`server/helpers/contribution.ts:1505`)
  // matches a spec to an account by owner name and ignores the row's
  // performance account, so B's money finds no account and lives only in
  // the aggregate, which counts as Retirement. Written as the property;
  // the verdict's figures (787,251.92 vs 784,726.80) belong to a generated
  // household that isn't committed.
  describe("engine/S1", () => {
    xfail({
      id: "engine/S1 [ENG-22]",
      todo: SPEC_TO_ACCOUNT,
      run: async () => {
        const { db, appDb, cleanup } = await freshDb();
        try {
          const a = person(db, "Alex", "1975-06-15", true);
          const b = person(db, "Sam", "1977-06-15", false);
          seedJob(db, a, { annualSalary: "100000", startDate: "2010-01-01" });
          const jobB = seedJob(db, b, {
            annualSalary: "80000",
            startDate: "2010-01-01",
          });
          holding(db, {
            ownerPersonId: a,
            accountType: "401k",
            parentCategory: "Retirement",
            taxType: "preTax",
            amount: 300_000,
            label: "Alex 401k",
          });
          const portfolio = holding(db, {
            ownerPersonId: a,
            accountType: "brokerage",
            parentCategory: "Portfolio",
            taxType: "afterTax",
            amount: 50_000,
            label: "Alex brokerage",
          });
          const acct = seedContributionAccount(db, {
            personId: b,
            jobId: jobB,
            accountType: "brokerage",
            parentCategory: "Portfolio",
            taxTreatment: "after_tax",
            performanceAccountId: portfolio,
          });
          const contributionProfileId = fixedContributions(db, {
            [acct]: 2_428,
          });
          const years = await projectFromPayload(appDb, contributionProfileId);
          let worstGap = 0;
          for (const y of years) {
            const retirementAccounts = y.individualAccountBalances
              .filter((x) => x.parentCategory === "Retirement")
              .reduce((s, x) => s + x.balance, 0);
            worstGap = Math.max(
              worstGap,
              Math.abs(y.retirementBalance - retirementAccounts),
            );
          }
          const first = years.find((y) => y.year === 2026)!;
          const toPortfolio = first.individualAccountBalances
            .filter((x) => x.parentCategory === "Portfolio")
            .reduce((s, x) => s + x.contribution, 0);
          return { worstGap, toPortfolio };
        } finally {
          cleanup();
        }
      },
      expected: { worstGap: 0, toPortfolio: 2_428 },
      tolerance: 1,
    });
  });
});
