/**
 * The engine ledgers (`H#.input.json`, `H#.ledger.csv`, `H#.accounts.csv`,
 * built by `build_ledgers.py` from `households.py`; see README.md), read
 * for the answer key, and a household in their input format turned into
 * the engine's `ProjectionInput`.
 *
 * The mapping fills the fields the way `build-engine-payload.ts` (the
 * only production caller, which needs a database) fills them for the same
 * household, with three exceptions the ledgers' README asks for:
 *
 * - `rothBracketTarget` is left unset (the payload always sets 0.12, which
 *   replaces a waterfall's order; engine verdict E2). Single-year cases
 *   that need the production target pass `rothBracketTarget`.
 * - `baseYearContributions` / `baseYearEmployerMatch` stay unset unless
 *   `baseYear` is asked for. The payload fills them, which sends year 0
 *   through the slot path (`accumulation-year.ts`); the ledgers match
 *   either way except for verdict E3, which only that path shows.
 * - `allowPenalizedWithdrawals` goes on every account only when asked for
 *   (H6: the default draws $0 before 59 1/2).
 *
 * The tax tables are the shipped 2026 file through the production
 * `buildDistributionTaxRates`. The plan starts 2026-01-01, so 2026 is a
 * whole year. Account order inside a category can only be said as
 * Traditional-first or Roth-first, which is all the ledgers need (one
 * account per waterfall step).
 */
import * as fs from "fs";
import * as path from "path";
import { buildDistributionTaxRates } from "@/lib/pure/distribution-tax-rates";
import {
  getAllCategories,
  type AccountCategory,
} from "@/lib/config/account-types";
import type {
  ContributionSpec,
  IndividualAccountInput,
  ProjectionInput,
} from "@/lib/calculators/types";
import { readTaxData, shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../../calculators/fixtures/engine-fixtures";

const HERE = __dirname;
const YEAR = 2026;

/** One person in a ledger input. Dates are `YYYY-MM-DD`. */
export interface LedgerPerson {
  id: string;
  primary: boolean;
  birthDate: string;
  /** Social Security a year in 2026 dollars, from `ssStartAge`. */
  ssAnnualToday: number;
  ssStartAge: number;
  jobs: {
    employer: string;
    start: string;
    end: string;
    salary: number;
    salaryGrowth: string;
  }[];
}

/** One account. `tax` is the bucket; brokerage accounts carry a basis. */
export interface LedgerAccount {
  id: string;
  owner: string;
  category: AccountCategory;
  tax: "traditional" | "roth" | "hsa" | "brokerage";
  parent: "Retirement" | "Portfolio";
  balance: number;
  basis?: number;
}

/** A payroll contribution: a share of pay or flat dollars a year. */
export interface LedgerContribution {
  person: string;
  account: string;
  kind: "percent" | "fixed";
  value: string | number;
  payroll: "pretax" | "roth" | "section125" | "aftertax";
  group: string | null;
  match?: { rate: string; capPercent: string; account: string };
}

/** A household in the ledgers' input format (`households.py`). */
export interface LedgerHousehold {
  id?: string;
  filingStatus: "Single" | "MFJ";
  inflation: string;
  limitGrowth: string;
  taxMultiplier: number;
  spendingStrategy: string;
  withdrawalRouting: string;
  lumpSums: { year: number; amount: number; account: string; note: string }[];
  people: LedgerPerson[];
  accounts: LedgerAccount[];
  contributions: LedgerContribution[];
  returnRates: { fromAge: number; rate: string }[];
  annualSpendingToday: number;
  /** Account ids, in draw order. */
  waterfall: string[];
  endYear: number;
}

/** A row of a ledger CSV, by column name. */
type CsvRow = Record<string, string>;

function readCsv(file: string): CsvRow[] {
  const [header, ...lines] = fs
    .readFileSync(path.join(HERE, file), "utf8")
    .trim()
    .split(/\r?\n/); // Python's csv module ends lines with \r\n
  const cols = header!.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

/** `H#.input.json`. */
export function readHousehold(id: string): LedgerHousehold {
  return JSON.parse(
    fs.readFileSync(path.join(HERE, `${id}.input.json`), "utf8"),
  ) as LedgerHousehold;
}

/** `H#.ledger.csv`: one row a year. */
export function readLedger(id: string): CsvRow[] {
  return readCsv(`${id}.ledger.csv`);
}

/** `H#.accounts.csv`: one row per account per year. */
export function readAccountRows(id: string): CsvRow[] {
  return readCsv(`${id}.accounts.csv`);
}

/** A CSV money cell; blank is 0. */
export function money(cell: string | undefined): number {
  return cell === undefined || cell === "" ? 0 : Number(cell);
}

/** `rmd_required` reads "A:x B:y": the household's total. */
export function rmdTotal(cell: string | undefined): number {
  return (cell ?? "")
    .split(" ")
    .filter((p) => p.includes(":"))
    .reduce((s, p) => s + Number(p.split(":")[1]), 0);
}

export interface LedgerInputOptions {
  /** Every account allows penalized withdrawals (engine/H6). */
  allowPenalizedWithdrawals?: boolean;
  /** Fill `baseYearContributions` / `baseYearEmployerMatch` as the payload
   *  does (E3). */
  baseYear?: boolean;
  /** The Roth bracket target the payload sets (0.12); unset otherwise. */
  rothBracketTarget?: number;
  /** List every category in the draw order after the household's own, as
   *  the payload does; otherwise only the categories the waterfall names. */
  everyCategory?: boolean;
}

const PERSON_ID: Record<string, number> = { A: 1, B: 2 };
const TAX_TYPE = {
  traditional: "preTax",
  roth: "taxFree",
  hsa: "hsa",
  brokerage: "afterTax",
} as const;
const TREATMENT = {
  pretax: "pre_tax",
  roth: "tax_free",
  section125: "hsa",
  aftertax: "after_tax",
} as const;

const yearOf = (date: string) => Number(date.slice(0, 4));

function limits2026(): Record<string, number> {
  const d = readTaxData().years[String(YEAR)]!;
  return Object.fromEntries(
    Object.entries(d.limits).map(([k, v]) => [k, v.value]),
  );
}

function taxRates(
  h: LedgerHousehold,
  limits: Record<string, number>,
  rothBracketTarget: number | undefined,
) {
  const d = readTaxData().years[String(YEAR)]!;
  const tables = shippedTaxTables(YEAR);
  const bracketData = d.withholding.tables[h.filingStatus]?.standard;
  if (!bracketData) throw new Error(`no ${YEAR} ${h.filingStatus} table`);
  const rates = buildDistributionTaxRates({
    settings: {
      distributionTaxRateTraditional: "0",
      distributionTaxRateBrokerage: "0.15",
      distributionTaxRateRoth: "0",
      distributionTaxRateHsa: "0",
      taxMultiplier: String(h.taxMultiplier),
      grossUpForTaxes: true,
      rothBracketTarget: "0.12",
      enableRothConversions: false,
      rothConversionTarget: null,
    },
    filingStatus: h.filingStatus,
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
    accumulationExpenses: h.annualSpendingToday,
    decumulationExpenses: h.annualSpendingToday,
    annualExpensesVal: h.annualSpendingToday,
  });
  return { ...rates, rothBracketTarget };
}

/** The household as the engine's input. */
export function ledgerInput(
  h: LedgerHousehold,
  opts: LedgerInputOptions = {},
): ProjectionInput {
  const limits = limits2026();
  const cats = getAllCategories();
  const zero = () =>
    Object.fromEntries(cats.map((c) => [c, 0])) as Record<
      AccountCategory,
      number
    >;
  const { people, accounts, contributions } = h;
  const primary = people.find((p) => p.primary) ?? people[0]!;
  const person = (id: string) => people.find((p) => p.id === id)!;
  const account = (id: string) => accounts.find((a) => a.id === id)!;
  const earners = people.filter((p) => p.jobs.length > 0);
  const multi = earners.length > 1;
  const lastJobYear = (p: LedgerPerson) => yearOf(p.jobs.at(-1)!.end);
  const salaryOf = (p: LedgerPerson) =>
    p.jobs.reduce((s, j) => s + j.salary, 0);
  const totalPay = people.reduce((s, p) => s + salaryOf(p), 0);
  const retirementYear = earners.length
    ? Math.max(...earners.map((p) => lastJobYear(p) + 1))
    : YEAR;

  // Employer match: a share of the employee's money in the plan group, up
  // to a share of pay, figured once per person per group.
  const matchByCat = zero();
  const contribByCat = zero();
  const matchByAccount: Record<string, number> = {};
  const matchByParent = new Map<AccountCategory, Map<string, number>>();
  const annual = (c: LedgerContribution) =>
    c.kind === "percent"
      ? Number(c.value) * salaryOf(person(c.person))
      : Number(c.value);
  for (const c of contributions) {
    if (!c.match) continue;
    const pay = salaryOf(person(c.person));
    const employee = contributions
      .filter((d) => d.person === c.person && d.group === c.group)
      .reduce((s, d) => s + annual(d), 0);
    const m =
      Number(c.match.rate) *
      Math.min(employee, Number(c.match.capPercent) * pay);
    const into = account(c.match.account);
    matchByCat[into.category] += m;
    matchByAccount[c.account] = m;
    const byParent = matchByParent.get(into.category) ?? new Map();
    byParent.set(into.parent, (byParent.get(into.parent) ?? 0) + m);
    matchByParent.set(into.category, byParent);
  }

  const specs: ContributionSpec[] = contributions.map((c) => {
    const a = account(c.account);
    const p = person(c.person);
    const base = annual(c);
    contribByCat[a.category] += base;
    const percent = c.kind === "percent";
    return {
      category: a.category,
      name: c.account,
      method: percent ? "percent_of_salary" : "fixed_monthly",
      value: percent ? Number(c.value) : Number(c.value) / 12,
      salaryFraction: totalPay > 0 ? salaryOf(p) / totalPay : 1,
      ...(percent ? { personPayShare: 1 } : {}),
      baseAnnual: base,
      taxTreatment: TREATMENT[c.payroll],
      personId: PERSON_ID[c.person],
      ownerName: c.person,
      accountName: c.account,
      targetAnnual: null,
      allocationPriority: 0,
      parentCategory: a.parent,
      ownership: "individual",
      retirementBehavior: "stops_at_owner_retirement",
      contributionScaling: percent ? "scales_with_salary" : "fixed_amount",
      hsaCoverageType:
        a.category === "hsa"
          ? h.filingStatus === "MFJ"
            ? "family"
            : "self_only"
          : null,
      employerShare:
        matchByCat[a.category] > 0
          ? (matchByAccount[c.account] ?? 0) / matchByCat[a.category]
          : 0,
      matchNeedsContribution: true,
    };
  });
  const retirementSaving = specs
    .filter((s) => s.parentCategory === "Retirement")
    .reduce((s, x) => s + x.baseAnnual, 0);

  const individualAccounts: IndividualAccountInput[] = accounts.map((a) => {
    const owner = person(a.owner);
    return {
      name: a.id,
      category: a.category,
      taxType: TAX_TYPE[a.tax],
      accountType: a.category,
      startingBalance: a.balance,
      ...(a.tax === "brokerage" ? { startingBasis: a.basis ?? 0 } : {}),
      ownerName: a.owner,
      ownerPersonId: PERSON_ID[a.owner],
      parentCategory: a.parent,
      ownerBirthYear: yearOf(owner.birthDate),
      ...(owner.jobs.length
        ? { ownerRetirementYear: lastJobYear(owner) + 1 }
        : {}),
      ...(opts.allowPenalizedWithdrawals
        ? { allowPenalizedWithdrawals: true }
        : {}),
    } as IndividualAccountInput;
  });
  // Production adds a projected-only Retirement brokerage for overflow and
  // reinvested RMDs when the plan holds none.
  if (!accounts.some((a) => a.tax === "brokerage" && a.parent === "Retirement"))
    individualAccounts.push({
      name: "projection-brokerage",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 0,
      startingBasis: 0,
      parentCategory: "Retirement",
      projectedOnly: true,
    } as IndividualAccountInput);

  const sum = (
    pick: (a: LedgerAccount) => boolean,
    f = (a: LedgerAccount) => a.balance,
  ) => accounts.filter(pick).reduce((s, a) => s + f(a), 0);
  const basis = sum(
    (a) => a.tax === "brokerage",
    (a) => a.basis ?? 0,
  );
  const startingAccountBalances = Object.fromEntries(
    cats.map((c) => [
      c,
      c === "hsa"
        ? { structure: "single_bucket", balance: sum((a) => a.category === c) }
        : c === "brokerage"
          ? {
              structure: "basis_tracking",
              balance: sum((a) => a.category === c),
              basis,
            }
          : {
              structure: "roth_traditional",
              traditional: sum(
                (a) => a.category === c && a.tax === "traditional",
              ),
              roth: sum((a) => a.category === c && a.tax === "roth"),
            },
    ]),
  ) as ProjectionInput["startingAccountBalances"];

  // The waterfall as a category order, plus each category's Traditional
  // or Roth preference.
  const order: AccountCategory[] = [];
  const preference: Partial<Record<AccountCategory, "traditional" | "roth">> =
    {};
  for (const id of h.waterfall) {
    const a = account(id);
    if (!order.includes(a.category)) order.push(a.category);
    if (
      (a.tax === "traditional" || a.tax === "roth") &&
      !preference[a.category]
    )
      preference[a.category] = a.tax;
  }
  if (opts.everyCategory)
    for (const c of cats) if (!order.includes(c)) order.push(c);
  const splits = zero();
  splits[order[0] ?? "brokerage"] = 1;
  const totalSaving = Object.values(contribByCat).reduce((a, b) => a + b, 0);

  return {
    accumulationDefaults: makeAccumulationDefaults({
      contributionRate: totalPay > 0 ? retirementSaving / totalPay : 0,
      accountSplits: Object.fromEntries(
        cats.map((c) => [
          c,
          totalSaving > 0 ? contribByCat[c] / totalSaving : 0,
        ]),
      ) as Record<AccountCategory, number>,
      taxSplits: Object.fromEntries(
        (["401k", "403b", "ira"] as const).map((c) => {
          const rows = specs.filter((s) => s.category === c);
          const all = rows.reduce((s, x) => s + x.baseAnnual, 0);
          const roth = rows
            .filter((x) => x.taxTreatment === "tax_free")
            .reduce((s, x) => s + x.baseAnnual, 0);
          return [c, all > 0 ? roth / all : 0];
        }),
      ),
    }),
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode:
        h.withdrawalRouting as ProjectionInput["decumulationDefaults"]["withdrawalRoutingMode"],
      withdrawalOrder: order,
      withdrawalSplits: splits,
      withdrawalTaxPreference: preference,
      distributionTaxRates: taxRates(h, limits, opts.rothBracketTarget),
      withdrawalStrategy:
        h.spendingStrategy as ProjectionInput["decumulationDefaults"]["withdrawalStrategy"],
      rmdExcessHandling: "reinvest",
      qcdMaximize: false,
      rmdSmoothingEnabled: false,
      discretionaryWithdrawalOrder: "roth_first",
    },
    accumulationOverrides: h.lumpSums.map((l) => {
      const a = account(l.account);
      return {
        year: l.year,
        lumpSums: [
          {
            amount: l.amount,
            targetAccount: a.category,
            targetAccountName: a.id,
            targetOwnerName: a.owner,
            targetParentCategory: a.parent,
            label: l.note,
          },
        ],
      };
    }),
    decumulationOverrides: [],
    currentAge: YEAR - yearOf(primary.birthDate),
    retirementYear,
    retirementYearByPerson: multi
      ? Object.fromEntries(
          earners.map((p) => [PERSON_ID[p.id], lastJobYear(p) + 1]),
        )
      : undefined,
    payrollTax: {
      socialSecurityRate: limits.fica_ss_rate!,
      medicareRate: limits.fica_medicare_rate!,
      socialSecurityWageBase: limits.ss_wage_base!,
    },
    budgetContributionLines: 0,
    projectionEndYear: h.endYear,
    currentSalary: totalPay,
    salaryGrowthRate: earners.length
      ? Number(earners[0]!.jobs[0]!.salaryGrowth)
      : 0,
    salaryGrowthRateByPerson: multi
      ? Object.fromEntries(
          earners.map((p) => [
            PERSON_ID[p.id],
            Number(p.jobs[0]!.salaryGrowth),
          ]),
        )
      : undefined,
    salaryCap: null,
    salaryOverrides: [],
    salaryByPerson: multi
      ? Object.fromEntries(earners.map((p) => [PERSON_ID[p.id], salaryOf(p)]))
      : undefined,
    perPersonSalaryOverrides: multi ? [] : undefined,
    workingYearsByPerson: earners.length
      ? Object.fromEntries(
          earners.map((p) => [
            PERSON_ID[p.id],
            { start: null, end: lastJobYear(p) },
          ]),
        )
      : undefined,
    budgetOverrides: [],
    irsLimitCaps: {
      filingStatus: h.filingStatus,
      limits,
      people: people.map((p) => ({
        id: PERSON_ID[p.id]!,
        birthYear: yearOf(p.birthDate),
      })),
      accounts: specs
        .filter((s) => s.category !== "brokerage")
        .map((s) => ({
          personId: s.personId!,
          accountType: s.category,
          hsaCoverageType: s.hsaCoverageType ?? null,
        })),
    },
    limitGrowthRate: Number(h.limitGrowth),
    employerMatchRateByCategory: Object.fromEntries(
      cats.map((c) => [c, totalPay > 0 ? matchByCat[c] / totalPay : 0]),
    ) as Record<AccountCategory, number>,
    contributionSpecs: specs,
    ...(opts.baseYear
      ? {
          baseYearContributions: contribByCat,
          baseYearEmployerMatch: matchByCat,
        }
      : {}),
    employerMatchByParentCat: matchByParent,
    brokerageContributionRamp: 0,
    brokerageGoals: [],
    startingBalances: {
      preTax: sum((a) => a.tax === "traditional"),
      taxFree: sum((a) => a.tax === "roth"),
      hsa: sum((a) => a.tax === "hsa"),
      afterTax: sum((a) => a.tax === "brokerage"),
      afterTaxBasis: basis,
    },
    startingAccountBalances,
    individualAccounts,
    annualExpenses: h.annualSpendingToday,
    inflationRate: Number(h.inflation),
    returnRates: h.returnRates.map((r) => ({
      label: `Age ${r.fromAge}`,
      rate: Number(r.rate),
    })),
    socialSecurityAnnual: people.length === 1 ? primary.ssAnnualToday : 0,
    ssStartAge: people.length === 1 ? primary.ssStartAge : 67,
    socialSecurityEntries:
      people.length > 1
        ? people.map((p) => ({
            personId: PERSON_ID[p.id]!,
            personName: p.id,
            annualAmount: p.ssAnnualToday,
            startAge: p.ssStartAge,
            birthYear: yearOf(p.birthDate),
          }))
        : undefined,
    birthYear: yearOf(primary.birthDate),
    filingStatus: h.filingStatus,
    enableIrmaaAwareness: false,
    irmaaOnTopOfBudget: false,
    gapYearStopSaving: false,
    gapYearDraws: true,
    primaryPersonId: 1,
    enableAcaAwareness: false,
    householdSize: people.length,
    perPersonBirthYears: people.map((p) => yearOf(p.birthDate)),
    asOfDate: new Date(Date.UTC(YEAR, 0, 1, 12)),
  };
}
