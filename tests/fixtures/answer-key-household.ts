/**
 * Invented households for the answer key's engine-year cases
 * (`tests/calculators/answer-key-tax-engine.test.ts`,
 * `answer-key-retirement-engine.test.ts`, and the survivor m30-MAGI in
 * `answer-key-tax.test.ts`), built as a plain
 * `ProjectionInput` the way `build-engine-payload.ts` fills one for a
 * retired household: person 1 owns the accounts, every account is a
 * Retirement account tracked on its own, and the tax tables are the
 * shipped 2026 file run through the production `buildDistributionTaxRates`.
 *
 * Flat on purpose, so a year's figures read straight off the tables: 0%
 * return, 0% inflation and 0% limit growth (the 2026 tables hold in every
 * year), waterfall routing, no Roth conversions, IRMAA and ACA awareness
 * off, the 12% Roth bracket target the builder always sets left unset.
 * The plan starts 2026-01-01, so 2026 is a whole year.
 */
import { buildDistributionTaxRates } from "@/lib/pure/distribution-tax-rates";
import {
  getAllCategories,
  type AccountCategory,
} from "@/lib/config/account-types";
import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
  IndividualAccountInput,
  ProjectionInput,
} from "@/lib/calculators/types";
import { readTaxData, shippedTaxTables } from "../helpers/tax-data";
import { runOneYear } from "./answer-key";
import { makeAccumulationDefaults } from "../calculators/fixtures/engine-fixtures";

const YEAR = 2026;

export interface KeyPerson {
  birthYear: number;
  /** Social Security a year, already claimed in 2026 (0% COLA). */
  socialSecurity?: number;
  /** A job's pay a year and its last year. In a two-person household a
   *  $0 job that ended before 2026 marks the retired one, so the other's
   *  working years are gap years (the engine needs a job per earner). */
  job?: { salary: number; lastYear: number };
}

export interface KeyHousehold {
  status: "Single" | "MFJ";
  /** Person 1 is primary and owns every account. */
  people: readonly KeyPerson[];
  /** Person 1's Traditional IRA. */
  traditionalIra?: number;
  /** Person 2's own Traditional IRA (per-owner RMDs). */
  spouseTraditionalIra?: number;
  /** Person 1's Roth IRA: its balance and the basis layers inside it
   *  (regular contributions, conversions and the latest conversion's
   *  year, as of the plan's start); the rest of the balance is earnings. */
  rothIra?: {
    balance: number;
    regular: number;
    conversions: number;
    latestConversionYear: number | null;
  };
  /** The household takes penalized early draws from every account. */
  allowPenalizedWithdrawals?: boolean;
  /** Person 1's taxable brokerage account. */
  brokerage?: { balance: number; basis: number };
  /** Spending a year (2026 dollars). */
  spending: number;
  /** A typed budget from a year on (monthly, sticky-forward). */
  budgetFrom?: { year: number; monthly: number }[];
  /** The last projected year. */
  endYear: number;
}

/** The shipped 2026 tax file's limits, as `"key" → value`. */
function limits2026(): Record<string, number> {
  const d = readTaxData().years[String(YEAR)];
  if (!d) throw new Error(`no ${YEAR} in tax-data`);
  return Object.fromEntries(
    Object.entries(d.limits).map(([k, v]) => [k, v.value]),
  );
}

function taxRates(h: KeyHousehold, limits: Record<string, number>) {
  const d = readTaxData().years[String(YEAR)]!;
  const tables = shippedTaxTables(YEAR);
  const bracketData = d.withholding.tables[h.status]?.standard;
  if (!bracketData) throw new Error(`no ${YEAR} ${h.status} table`);
  const rates = buildDistributionTaxRates({
    settings: {
      distributionTaxRateTraditional: "0",
      distributionTaxRateBrokerage: "0.15",
      distributionTaxRateRoth: "0",
      distributionTaxRateHsa: "0",
      taxMultiplier: "1",
      grossUpForTaxes: true,
      rothBracketTarget: "0.12",
      enableRothConversions: false,
      rothConversionTarget: null,
    },
    filingStatus: h.status,
    limitsMap: limits,
    bracketData: bracketData as {
      threshold: number;
      baseWithholding: number;
      rate: number;
    }[],
    ltcgBracketData: tables.ltcgBrackets as never,
    irmaaBracketData: tables.irmaaBrackets as never,
    fplByHousehold: tables.fplByHousehold as never,
    latestTaxYear: YEAR,
    taxParamsVersion: d.revision,
    accumulationExpenses: h.spending,
    decumulationExpenses: h.spending,
    annualExpensesVal: h.spending,
  });
  return { ...rates, rothBracketTarget: undefined };
}

/** The household as the engine's input. */
export function engineHousehold(h: KeyHousehold): ProjectionInput {
  const limits = limits2026();
  const cats = getAllCategories();
  const zero = () =>
    Object.fromEntries(cats.map((c) => [c, 0])) as Record<
      AccountCategory,
      number
    >;
  const people = h.people.map((p, i) => ({ ...p, id: i + 1 }));
  const primary = people[0]!;
  const earners = people.filter((p) => p.job);
  const multi = earners.length > 1;
  const retirementYear = earners.length
    ? Math.max(...earners.map((p) => p.job!.lastYear + 1))
    : YEAR;
  const totalPay = earners.reduce((s, p) => s + p.job!.salary, 0);
  const ownerRetirementYear = primary.job
    ? primary.job.lastYear + 1
    : undefined;

  const owned = {
    ownerName: "A",
    ownerPersonId: 1,
    ownerBirthYear: primary.birthYear,
    parentCategory: "Retirement",
    ...(ownerRetirementYear ? { ownerRetirementYear } : {}),
  };
  const penalized = h.allowPenalizedWithdrawals
    ? { allowPenalizedWithdrawals: true }
    : {};
  const ownIra = h.traditionalIra ?? 0;
  const spouseIra = h.spouseTraditionalIra ?? 0;
  const ira = ownIra + spouseIra;
  const roth = h.rothIra?.balance ?? 0;
  const brokerage = h.brokerage ?? { balance: 0, basis: 0 };
  const accounts: IndividualAccountInput[] = [];
  if (ownIra > 0)
    accounts.push({
      name: "A IRA",
      category: "ira",
      taxType: "preTax",
      accountType: "ira",
      startingBalance: ownIra,
      ...owned,
      ...penalized,
    } as IndividualAccountInput);
  if (spouseIra > 0) {
    const spouse = people[1];
    if (!spouse) throw new Error("a spouse's IRA needs a second person");
    accounts.push({
      name: "B IRA",
      category: "ira",
      taxType: "preTax",
      accountType: "ira",
      startingBalance: spouseIra,
      ownerName: "B",
      ownerPersonId: 2,
      ownerBirthYear: spouse.birthYear,
      parentCategory: "Retirement",
      ...penalized,
    } as IndividualAccountInput);
  }
  if (h.rothIra)
    accounts.push({
      name: "A Roth IRA",
      category: "ira",
      taxType: "taxFree",
      accountType: "ira",
      startingBalance: roth,
      ...owned,
      ...penalized,
      rothBasisMeta: {
        year: YEAR,
        contributionBasis: h.rothIra.regular,
        conversionBasis: h.rothIra.conversions,
        latestConversionYear: h.rothIra.latestConversionYear,
        isSeeded: false,
        updatedAt: new Date(Date.UTC(YEAR, 0, 1)),
      },
    } as IndividualAccountInput);
  if (brokerage.balance > 0)
    accounts.push({
      name: "A brokerage",
      category: "brokerage",
      taxType: "afterTax",
      accountType: "brokerage",
      startingBalance: brokerage.balance,
      startingBasis: brokerage.basis,
      ...owned,
      ...penalized,
    } as IndividualAccountInput);
  // Production adds a projected-only brokerage for overflow and reinvested
  // RMDs when the plan holds none.
  else
    accounts.push({
      name: "projection-brokerage",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
      startingBasis: 0,
      parentCategory: "Retirement",
      projectedOnly: true,
    } as IndividualAccountInput);

  const order: AccountCategory[] = [];
  if (ira > 0 || roth > 0) order.push("ira");
  if (brokerage.balance > 0) order.push("brokerage");
  const splits = zero();
  splits[order[0] ?? "brokerage"] = 1;
  const accountBalances = Object.fromEntries(
    cats.map((c) => [
      c,
      c === "hsa"
        ? { structure: "single_bucket", balance: 0 }
        : c === "brokerage"
          ? {
              structure: "basis_tracking",
              balance: brokerage.balance,
              basis: brokerage.basis,
            }
          : {
              structure: "roth_traditional",
              traditional: c === "ira" ? ira : 0,
              roth: c === "ira" ? roth : 0,
            },
    ]),
  );

  return {
    accumulationDefaults: makeAccumulationDefaults({
      contributionRate: 0,
      accountSplits: zero(),
      taxSplits: { "401k": 0, "403b": 0, ira: 0 },
    }),
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: order,
      withdrawalSplits: splits,
      withdrawalTaxPreference:
        ira > 0 ? { ira: "traditional" } : roth > 0 ? { ira: "roth" } : {},
      distributionTaxRates: taxRates(h, limits),
      withdrawalStrategy: "fixed",
      rmdExcessHandling: "reinvest",
      qcdMaximize: false,
      rmdSmoothingEnabled: false,
      discretionaryWithdrawalOrder: "roth_first",
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: YEAR - primary.birthYear,
    retirementYear,
    retirementYearByPerson: multi
      ? Object.fromEntries(earners.map((p) => [p.id, p.job!.lastYear + 1]))
      : undefined,
    payrollTax: {
      socialSecurityRate: limits.fica_ss_rate!,
      medicareRate: limits.fica_medicare_rate!,
      socialSecurityWageBase: limits.ss_wage_base!,
    },
    budgetContributionLines: 0,
    projectionEndYear: h.endYear,
    currentSalary: totalPay,
    salaryGrowthRate: 0,
    salaryGrowthRateByPerson: multi
      ? Object.fromEntries(earners.map((p) => [p.id, 0]))
      : undefined,
    salaryCap: null,
    salaryOverrides: [],
    salaryByPerson: multi
      ? Object.fromEntries(earners.map((p) => [p.id, p.job!.salary]))
      : undefined,
    perPersonSalaryOverrides: multi ? [] : undefined,
    workingYearsByPerson: earners.length
      ? Object.fromEntries(
          earners.map((p) => [p.id, { start: null, end: p.job!.lastYear }]),
        )
      : undefined,
    budgetOverrides: (h.budgetFrom ?? []).map((b) => ({
      year: b.year,
      value: b.monthly,
    })),
    irsLimitCaps: {
      filingStatus: h.status,
      limits,
      people: people.map((p) => ({ id: p.id, birthYear: p.birthYear })),
      accounts: [],
    },
    limitGrowthRate: 0,
    employerMatchRateByCategory: zero(),
    contributionSpecs: [],
    employerMatchByParentCat: new Map(),
    brokerageContributionRamp: 0,
    brokerageGoals: [],
    startingBalances: {
      preTax: ira,
      taxFree: roth,
      hsa: 0,
      afterTax: brokerage.balance,
      afterTaxBasis: brokerage.basis,
    },
    startingAccountBalances:
      accountBalances as ProjectionInput["startingAccountBalances"],
    individualAccounts: accounts,
    annualExpenses: h.spending,
    inflationRate: 0,
    returnRates: [{ label: "0%", rate: 0 }],
    socialSecurityAnnual:
      people.length === 1 ? (primary.socialSecurity ?? 0) : 0,
    ssStartAge: 67,
    socialSecurityEntries:
      people.length > 1
        ? people.map((p) => ({
            personId: p.id,
            personName: p.id === 1 ? "A" : "B",
            annualAmount: p.socialSecurity ?? 0,
            startAge: 67,
            birthYear: p.birthYear,
          }))
        : undefined,
    birthYear: primary.birthYear,
    filingStatus: h.status,
    enableIrmaaAwareness: false,
    irmaaOnTopOfBudget: false,
    gapYearStopSaving: false,
    gapYearDraws: true,
    primaryPersonId: 1,
    enableAcaAwareness: false,
    householdSize: people.length,
    perPersonBirthYears: people.map((p) => p.birthYear),
    asOfDate: new Date(Date.UTC(YEAR, 0, 1, 12)),
  };
}

/** The household's year `year`, which must be a retired year. */
export function retiredYear(
  h: KeyHousehold,
  year: number,
): EngineDecumulationYear {
  const r = runOneYear(engineHousehold(h), year);
  if (r.phase !== "decumulation") throw new Error(`${year} isn't retired`);
  return r;
}

/** The household's year `year`, which must be a gap year (someone works,
 *  someone draws). */
export function gapYear(
  h: KeyHousehold,
  year: number,
): EngineAccumulationYear & {
  gapDraw: NonNullable<EngineAccumulationYear["gapDraw"]>;
} {
  const r = runOneYear(engineHousehold(h), year);
  if (r.phase !== "accumulation" || !r.gapDraw)
    throw new Error(`${year} isn't a gap year`);
  return r as EngineAccumulationYear & {
    gapDraw: NonNullable<EngineAccumulationYear["gapDraw"]>;
  };
}
