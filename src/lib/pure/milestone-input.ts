/**
 * Milestones input builders — pure mappings from what the app already
 * computes (year-end history, projection, contribution and holdings
 * summaries) into the MilestoneInput that evaluateMilestones() judges.
 * Split from milestones.ts, which holds the rules themselves.
 */
import {
  getAccountTypeConfig,
  getAllCategories,
  isRetirementParent,
  isTaxableCategory,
} from "@/lib/config/account-types";
import { canSwitchFunds } from "@/lib/pure/fund-findings";
import { sharesHouseholdLimit } from "@/lib/pure/contribution-caps";
import type { AccountCategory } from "@/lib/config/account-types.types";
import {
  FUND_MAIN_BUCKET_SHARE,
  type SavingsTargetSource,
  type CheckpointSource,
} from "@/lib/config/milestones";
import type { CompositionBucket } from "@/lib/config/enum-values";
import { safeDivide } from "@/lib/utils/math";
import {
  householdSavings,
  householdTotalCompensation,
  isHighIncomeHousehold,
  type SavingsRatePerson,
} from "@/lib/pure/contributions";
import type {
  CustomGoal,
  MilestoneDebt,
  MatchShortfall,
  MilestoneChecklist,
  MilestoneInput,
  MilestoneLimit,
  MilestoneProjectionYear,
  MilestoneYear,
} from "@/lib/pure/milestones";

/** Account-type config for a category key, or null when it isn't one. */
function configOf(key: string) {
  return getAllCategories().includes(key as AccountCategory)
    ? getAccountTypeConfig(key as AccountCategory)
    : null;
}

/** Calendar year of a payoff date. A date-only string's year is read as
 *  written (its first four digits), never via `new Date()`, which parses
 *  a Jan 1 date as UTC midnight and lands on the prior year west of UTC. */
function payoffYearOf(payoffDate: Date | string): number {
  return typeof payoffDate === "string"
    ? Number(payoffDate.slice(0, 4))
    : payoffDate.getFullYear();
}

// ---------------------------------------------------------------------------
// Input builders (pure mappings from what the app already computes)
// ---------------------------------------------------------------------------

/** A year-end history row → the milestones' view of it. Retirement vs
 *  brokerage follows each account's own parent category (the tax-location
 *  breakdown); rows without one fall back to the account-type config. */
export function milestoneYearFromHistory(row: {
  year: number;
  isCurrent: boolean;
  averageAge: number;
  netWorthMarket: number;
  portfolioTotal: number;
  portfolioByType: Record<string, number>;
  portfolioByTaxLocation: {
    retirement: Record<string, number>;
    portfolio: Record<string, number>;
  } | null;
  cash: number;
  /** The year's gross income — wealthFormulaIncome(row), not averaged. */
  grossIncome: number;
  perfContributions: number | null;
  perfEmployerMatch: number | null;
  perfGainLoss: number | null;
  aawScoreMarket: number;
  fiProgress: number;
  mortgageBalance: number;
  otherLiabilities: number;
}): MilestoneYear {
  const sum = (r: Record<string, number>) =>
    Object.values(r).reduce((s, v) => s + v, 0);
  let retirement = 0;
  if (row.portfolioByTaxLocation) {
    retirement = sum(row.portfolioByTaxLocation.retirement);
  } else {
    for (const [type, amount] of Object.entries(row.portfolioByType)) {
      const config = configOf(type);
      if (config && isRetirementParent(config.parentCategory))
        retirement += amount;
    }
  }
  return {
    year: row.year,
    isCurrent: row.isCurrent,
    age: row.averageAge,
    netWorth: row.netWorthMarket,
    liquid: row.portfolioTotal + row.cash,
    cash: row.cash,
    retirement,
    brokerage: Math.max(0, row.portfolioTotal - retirement),
    grossIncome: row.grossIncome,
    contributions:
      !row.isCurrent && row.perfContributions !== null
        ? row.perfContributions + (row.perfEmployerMatch ?? 0)
        : null,
    gain: !row.isCurrent ? row.perfGainLoss : null,
    wealthScore: row.aawScoreMarket,
    fiProgress: row.fiProgress,
    mortgageBalance: row.mortgageBalance,
    otherLiabilities: row.otherLiabilities,
  };
}

/** Projection years → the milestones' view (today's cash held flat). */
export function milestoneProjectionYears(
  years: readonly {
    year: number;
    age: number;
    phase: string;
    allAccountsBalance: number;
    projectedSalary?: number;
    totalEmployee?: number;
    totalEmployer?: number;
  }[],
  cashToday: number,
): MilestoneProjectionYear[] {
  return years.map((y) => {
    const working = y.phase === "accumulation";
    return {
      year: y.year,
      age: y.age,
      // FI milestones are liquid net worth: every account (Portfolio
      // included) plus cash.
      liquid: y.allAccountsBalance + cashToday,
      salary: working ? (y.projectedSalary ?? 0) : null,
      contributions: working
        ? (y.totalEmployee ?? 0) + (y.totalEmployer ?? 0)
        : null,
    };
  });
}

type LimitAccount = {
  categoryKey: string;
  accountType: string;
  /** The account's own parent category (Retirement / Portfolio). */
  parentCategory: string;
  limit: number;
  employeeContrib: number;
  totalContrib: number;
  /** A year's contributions through payroll, and outside it. */
  payrollDeductedContrib?: number;
  nonPayrollContrib?: number;
  /** HSA coverage behind the limit; null/absent when not set. */
  hsaCoverageType?: string | null;
};

/**
 * Contributions vs IRS limits, one row per person per limit group (401k and
 * 403b share one limit). A household-wide limit is counted once only when
 * it's shared (`sharesHouseholdLimit`: married, family HSA coverage) — two
 * self-only HSAs are two limits, as the contribution caps hold them.
 * Employee money only, unless the IRS limit itself counts employer money
 * (config `matchCountsTowardLimit`, e.g. HSA). A row is "retirement" when
 * any of its accounts sits in the Retirement parent category.
 */
export function milestoneLimits(
  people: readonly {
    name: string;
    accountTypes: readonly LimitAccount[];
    /** Paychecks left this year (null: unknown). */
    checksLeft?: number | null;
  }[],
  joint: readonly LimitAccount[],
  /** The household's filing status (whether an HSA limit is shared). */
  filingStatus = "",
): MilestoneLimit[] {
  const rows = new Map<string, MilestoneLimit>();
  // Shared household limits, by limit group, from every account in it.
  const all = [...people.flatMap((p) => p.accountTypes), ...joint];
  const shared = new Set(
    all.flatMap((a) => {
      const group = configOf(a.categoryKey)?.irsLimitGroup;
      if (!group) return [];
      const coverages = all
        .filter((b) => configOf(b.categoryKey)?.irsLimitGroup === group)
        .map((b) => b.hsaCoverageType ?? null);
      return sharesHouseholdLimit(a.categoryKey, filingStatus, coverages)
        ? [group]
        : [];
    }),
  );
  // Through payroll or outside it, from where the money goes today.
  const route = (a: LimitAccount): boolean | null =>
    (a.payrollDeductedContrib ?? 0) > 0
      ? true
      : (a.nonPayrollContrib ?? 0) > 0
        ? false
        : null;
  const add = (owner: string, a: LimitAccount, checksLeft: number | null) => {
    const config = configOf(a.categoryKey);
    // A limited account with no limit found (the year's IRS limits not
    // entered yet) stays in as limit 0 — judged "not enough data", never
    // silently dropped.
    if (!config || !config.irsLimitGroup) return;
    const who = shared.has(config.irsLimitGroup) ? "Household" : owner;
    const key = `${who}|${config.irsLimitGroup}`;
    const contributed = config.matchCountsTowardLimit
      ? a.totalContrib
      : a.employeeContrib;
    const retirement = isRetirementParent(a.parentCategory);
    const existing = rows.get(key);
    if (existing) {
      existing.contributed += contributed;
      existing.limit = Math.max(existing.limit, a.limit);
      existing.retirement ||= retirement;
      existing.payroll = existing.payroll ?? route(a);
    } else {
      rows.set(key, {
        fooStep5: config.fooStep === 5,
        retirement,
        owner: who,
        label: config.displayLabel,
        contributed,
        limit: a.limit,
        payroll: route(a),
        // A household-wide group has no one person's paychecks.
        checksLeft: who === owner ? checksLeft : null,
      });
    }
  };
  for (const p of people)
    for (const a of p.accountTypes) add(p.name, a, p.checksLeft ?? null);
  for (const a of joint) add("Household", a, null);
  return [...rows.values()];
}

/** A year's employee contributions to Retirement-category accounts with no
 *  IRS limit (e.g. a brokerage account set aside for retirement). */
export function retirementUnlimitedContributions(
  accounts: readonly LimitAccount[],
): number {
  return accounts
    .filter((a) => {
      if (!isRetirementParent(a.parentCategory)) return false;
      const config = configOf(a.categoryKey);
      return !config?.irsLimitGroup;
    })
    .reduce((sum, a) => sum + a.employeeContrib, 0);
}

/** Bogleheads view of the linked holdings: class shares of the money whose
 *  mix is known (the Benchmarks page's denominator) vs glide-path targets. */
export function milestoneHoldings(overview: {
  allocation: {
    total: number;
    unknown: number;
    rows: {
      name: string;
      value: number;
      targetPct: number | null;
      /** The fund categories counted toward this class. */
      buckets?: readonly CompositionBucket[];
    }[];
    unmapped?: { value: number }[];
  };
  /** SimpleFIN accounts not linked to a Ledgr account (left out). */
  unlinkedAccounts?: { total: number }[];
  cost: { expenseRatio: number | null; coveredShare: number };
  accounts?: {
    accountType?: string | null;
    holdings: {
      securityId: number | null;
      name: string | null;
      symbol: string | null;
      value?: number;
      facts: {
        expenseRatio: { value: number } | null;
        composition: { buckets: Record<CompositionBucket, number> } | null;
      };
    }[];
  }[];
}): MilestoneInput["holdings"] {
  const { total, unknown, rows } = overview.allocation;
  if (total <= 0) return null;
  const known = total - unknown;
  const classOfBucket = new Map<CompositionBucket, string>();
  for (const r of rows)
    for (const b of r.buckets ?? []) classOfBucket.set(b, r.name);
  // Each class's dollars by where they sit: taxable or tax-advantaged.
  const where = new Map<string, { taxable: number; sheltered: number }>();
  // Each fund once (it can sit in several accounts), by its main category.
  const funds = new Map<
    string,
    {
      name: string;
      bucket: CompositionBucket;
      expenseRatio: number;
      switchable: boolean;
    }
  >();
  for (const a of overview.accounts ?? []) {
    const taxable = a.accountType ? isTaxableCategory(a.accountType) : false;
    for (const h of a.holdings) {
      const buckets = h.facts.composition?.buckets;
      if (buckets && h.value)
        for (const [b, share] of Object.entries(buckets) as [
          CompositionBucket,
          number,
        ][]) {
          const cls = classOfBucket.get(b);
          if (!cls || share <= 0) continue;
          const w = where.get(cls) ?? { taxable: 0, sheltered: 0 };
          if (taxable) w.taxable += h.value * share;
          else w.sheltered += h.value * share;
          where.set(cls, w);
        }
      const er = h.facts.expenseRatio?.value;
      if (er == null || !buckets) continue;
      const main = (
        Object.entries(buckets) as [CompositionBucket, number][]
      ).find(([, share]) => share >= FUND_MAIN_BUCKET_SHARE);
      if (!main) continue;
      const key = String(h.securityId ?? h.symbol ?? h.name);
      funds.set(key, {
        name: h.symbol ?? h.name ?? "A fund",
        bucket: main[0],
        expenseRatio: er,
        switchable:
          (funds.get(key)?.switchable ?? false) ||
          canSwitchFunds(a.accountType ?? null),
      });
    }
  }
  return {
    coverage: safeDivide(known, total, 0),
    knownValue: known,
    unlinkedValue: (overview.allocation.unmapped ?? []).reduce(
      (sum, u) => sum + u.value,
      0,
    ),
    unlinkedAccountsValue: (overview.unlinkedAccounts ?? []).reduce(
      (sum, a) => sum + a.total,
      0,
    ),
    classes: rows.map((r) => ({
      name: r.name,
      share: safeDivide(r.value, known, 0),
      targetShare: r.targetPct,
      taxableValue: where.get(r.name)?.taxable ?? 0,
      shelteredValue: where.get(r.name)?.sheltered ?? 0,
    })),
    expenseRatio: overview.cost.expenseRatio,
    costCoverage: overview.cost.coveredShare,
    funds: [...funds.values()],
  };
}

/**
 * After-tax ("mega backdoor") room per person in plans with an IRS
 * total-additions limit (config `irsLimitKeys.totalAdditions`): the lesser
 * of that limit and the person's pay, less employee deferrals up to the
 * base limit (catch-up doesn't count) and the employer match. Assumes one
 * employer plan per person (each unrelated employer has its own limit) and
 * no profit-sharing contributions (not modelled).
 */
export function megaBackdoorRoom(
  people: readonly {
    name: string;
    /** The person's pay (salary + bonus) — 415(c) caps at 100% of it. */
    compensation: number;
    accountTypes: readonly {
      categoryKey: string;
      employeeContrib: number;
      employerMatch: number;
    }[];
  }[],
  limitsRecord: Record<string, number>,
): { owner: string; room: number; limit: number }[] {
  const out: { owner: string; room: number; limit: number }[] = [];
  for (const p of people) {
    let limit = 0;
    let base = 0;
    let employee = 0;
    let employer = 0;
    for (const a of p.accountTypes) {
      const keys = configOf(a.categoryKey)?.irsLimitKeys;
      if (!keys?.totalAdditions) continue;
      limit = limitsRecord[keys.totalAdditions] ?? 0;
      base = limitsRecord[keys.base] ?? 0;
      employee += a.employeeContrib;
      employer += a.employerMatch;
    }
    if (limit <= 0) continue;
    if (p.compensation > 0) limit = Math.min(limit, p.compensation);
    out.push({
      owner: p.name,
      room: Math.max(0, limit - Math.min(employee, base) - employer),
      limit,
    });
  }
  return out;
}

type MilestoneAccount = LimitAccount &
  SavingsRatePerson["accountTypes"][number] & {
    employerMatch: number;
    employerMatchAvailable: number;
    /** Percent of pay elected (whole number); null for a fixed amount. */
    currentPctOfSalary?: number | null;
    /** Percent of pay that gets the full match; null when the match
     *  doesn't depend on the rate. */
    fullMatchPctOfSalary?: number | null;
  };

/** Accounts getting less than their full employer match (a dollar or
 *  more a year), with the rate that gets it. */
export function matchShortfalls(
  people: readonly {
    name: string;
    accountTypes: readonly MilestoneAccount[];
  }[],
): MatchShortfall[] {
  return people.flatMap((p) =>
    p.accountTypes.flatMap((a) => {
      const missed = a.employerMatchAvailable - a.employerMatch;
      return missed >= 1
        ? [
            {
              owner: p.name,
              label: a.accountType,
              missed,
              currentPct: a.currentPctOfSalary ?? null,
              fullPct: a.fullMatchPctOfSalary ?? null,
            },
          ]
        : [];
    }),
  );
}

/**
 * Everything the app already computes → the engine's input. The one place
 * these figures are mapped, so the page and the dashboard card can't each
 * derive "liquid", the savings rate or housing cost their own way.
 */
export function buildMilestoneInput(raw: {
  inputs: {
    asOfYear: number;
    years: MilestoneYear[];
    fiTarget: number;
    customGoals: CustomGoal[];
    checklist: MilestoneChecklist;
    checkpointSource: CheckpointSource;
    savingsTargetSource: SavingsTargetSource;
    debts?: MilestoneDebt[] | null;
    otherDebt?: { manual: number; creditCardMapped: number } | null;
  };
  contributions: {
    people: (Omit<SavingsRatePerson, "accountTypes"> & {
      person: { name: string };
      accountTypes: MilestoneAccount[];
      /** Paychecks a year, and those already paid this year. */
      periodsPerYear?: number;
      periodsElapsedYtd?: number;
    })[];
    jointAccountTypes: MilestoneAccount[];
    /** The year's IRS limits, by key. */
    limits?: Record<string, number>;
    /** The household's filing status (whether an HSA limit is shared). */
    filingStatus?: string;
  } | null;
  highIncomeThreshold: number;
  brokerageGoals?: { name: string; targetYear: number }[] | null;
  efundMonths: number | null;
  efundEssentialMonthly?: number | null;
  mortgage: {
    loans: {
      id: number;
      principalAndInterest: string | number;
      pmi: string | number;
      insuranceAndTaxes: string | number;
      interestRate?: string | number | null;
    }[];
    activeLoanId: number | null;
    activeLoanResult: {
      remainingMonths: number;
      payoffDate: Date | string;
      currentBalance?: number;
    } | null;
  } | null;
  projection: {
    projectionByYear: Parameters<typeof milestoneProjectionYears>[0];
    annualInflation: number;
  } | null;
  holdings: Parameters<typeof milestoneHoldings>[0] | null;
}): MilestoneInput {
  const { inputs } = raw;
  const now = inputs.years[inputs.years.length - 1];
  const cashToday = now?.cash ?? 0;

  let savings: MilestoneInput["savings"] = null;
  let match: MilestoneInput["match"] = null;
  let limits: MilestoneInput["limits"] = null;
  let retirementUnlimited: MilestoneInput["retirementUnlimited"] = null;
  let mega: MilestoneInput["megaBackdoor"] = null;
  const c = raw.contributions;
  const people = c?.people.filter((p) => p.accountTypes.length > 0) ?? [];
  if (c && people.length > 0) {
    // Money Guy's definitions, fixed — not the per-viewer display switches,
    // on the full year's plan, the match counted below the high-income
    // threshold. The 25% rule (step 7) counts Retirement and Portfolio
    // money alike; step 6's "25% before maxing out" is the Retirement
    // category alone.
    const highIncome = isHighIncomeHousehold(
      householdTotalCompensation(people),
      raw.highIncomeThreshold,
    );
    const breakdown = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      { excludeMatch: highIncome, includePortfolio: true },
    );
    const retirementOnly = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      { excludeMatch: highIncome, includePortfolio: false },
    );
    const withMatch = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      {
        excludeMatch: false,
        includePortfolio: true,
      },
    );
    savings = {
      rate: breakdown.rate,
      retirementRate: retirementOnly.rate,
      saved: breakdown.total,
      savedWithMatch: withMatch.total,
      compensation: breakdown.compensation,
      matchCounted: !highIncome,
      highIncome,
      highIncomeThreshold: raw.highIncomeThreshold,
      breakdown,
    };
    const accounts = [
      ...people.flatMap((p) => p.accountTypes),
      ...c.jointAccountTypes,
    ];
    match = {
      captured: accounts.reduce((sum, a) => sum + a.employerMatch, 0),
      available: accounts.reduce(
        (sum, a) => sum + Math.max(a.employerMatch, a.employerMatchAvailable),
        0,
      ),
      shortfalls: matchShortfalls(
        people.map((p) => ({
          name: p.person.name,
          accountTypes: p.accountTypes,
        })),
      ),
    };
    retirementUnlimited = retirementUnlimitedContributions(accounts);
    mega = c.limits
      ? megaBackdoorRoom(
          people.map((p) => ({
            name: p.person.name,
            compensation: p.totalCompensation ?? p.salary ?? 0,
            accountTypes: p.accountTypes,
          })),
          c.limits,
        )
      : null;
    limits = milestoneLimits(
      people.map((p) => ({
        name: p.person.name,
        accountTypes: p.accountTypes,
        checksLeft:
          p.periodsPerYear !== undefined && p.periodsElapsedYtd !== undefined
            ? Math.max(0, p.periodsPerYear - p.periodsElapsedYtd)
            : null,
      })),
      c.jointAccountTypes,
      c.filingStatus,
    );
  }

  let mortgage: MilestoneInput["mortgage"] = null;
  const m = raw.mortgage;
  if (m) {
    const loan = m.loans.find((l) => l.id === m.activeLoanId);
    const active = Boolean(
      loan && m.activeLoanResult && m.activeLoanResult.remainingMonths > 0,
    );
    mortgage = {
      active,
      monthlyHousingCost: loan
        ? Number(loan.principalAndInterest) +
          Number(loan.pmi) +
          Number(loan.insuranceAndTaxes)
        : 0,
      payoffYear:
        active && m.activeLoanResult
          ? payoffYearOf(m.activeLoanResult.payoffDate)
          : null,
      balance: active ? (m.activeLoanResult?.currentBalance ?? null) : null,
      annualRate: loan?.interestRate != null ? Number(loan.interestRate) : null,
      principalAndInterest: loan ? Number(loan.principalAndInterest) : null,
    };
  }

  // Years before the household's records start (all zeros) say nothing —
  // left in, "net worth ≥ $0" would read as reached the first empty year.
  const years = inputs.years.filter(
    (y) =>
      y.isCurrent || y.netWorth !== 0 || y.liquid !== 0 || y.grossIncome !== 0,
  );
  return {
    asOfYear: inputs.asOfYear,
    years,
    projection: raw.projection
      ? {
          years: milestoneProjectionYears(
            raw.projection.projectionByYear,
            cashToday,
          ),
          inflationRate: raw.projection.annualInflation,
        }
      : null,
    fiTarget: inputs.fiTarget,
    savings,
    match,
    limits,
    retirementUnlimited,
    efundMonths: raw.efundMonths,
    efundEssentialMonthly: raw.efundEssentialMonthly ?? null,
    mortgage,
    holdings: raw.holdings ? milestoneHoldings(raw.holdings) : null,
    checklist: inputs.checklist,
    customGoals: inputs.customGoals,
    debts: inputs.debts ?? null,
    otherDebt: inputs.otherDebt ?? null,
    checkpointSource: inputs.checkpointSource,
    savingsTargetSource: inputs.savingsTargetSource,
    megaBackdoor: mega,
    brokerageGoals: raw.brokerageGoals ?? null,
  };
}
