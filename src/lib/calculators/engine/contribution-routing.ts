/**
 * Contribution Routing — accumulation-phase allocation.
 *
 * Three routing modes:
 * - routeWaterfall: fill accounts in priority order
 * - routePercentage: split by configured percentages
 * - routeFromSpecs: per-account specs from DB (dominant production path)
 *
 * All modes receive ResolvedAccumulationConfig — never raw overrides.
 */
import type {
  ContributionSpec,
  ResolvedAccumulationConfig,
  AccumulationSlot,
  AccountCategory,
  TaxSplitConfig,
} from "../types";
import { roundToCents, sumBy } from "../../utils/math";
import {
  getRothFraction as configGetRothFraction,
  getAllCategories,
  getAccountTypeConfig,
  getEffectiveLimit as configGetEffectiveLimit,
  isOverflowTarget,
  categoriesWithIrsLimit,
  buildCategoryRecord,
  isRetirementMoney,
  isTaxFree,
  isPreTaxTreatment,
  isHsaTreatment,
  getLimitGroup,
} from "../../config/account-types";
import {
  capContributionsByLimitGroup,
  type CapContext,
  type CappedContribution,
  type CapRow,
} from "../../pure/contribution-caps";
import { OVERFLOW_TOLERANCE } from "../../constants";
import { projectSpecAmount } from "./contribution-projection";

const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

/**
 * Get the Roth fraction for an account category.
 * Delegates to config-driven helper — no hardcoded category checks.
 */
function getRothFraction(
  category: AccountCategory,
  taxSplits: TaxSplitConfig,
): number {
  return configGetRothFraction(category, taxSplits);
}

/**
 * The employee money that fits under a category's effective limit: employer
 * money that counts toward the IRS limit (HSA) comes off the IRS limit
 * first; an account cap bounds employee money only.
 */
function employeeRoom(
  category: AccountCategory,
  irsLimit: number,
  effectiveLimit: number,
  employerMatch: Record<AccountCategory, number>,
): number {
  const counted = getAccountTypeConfig(category).matchCountsTowardLimit
    ? (employerMatch[category] ?? 0)
    : 0;
  return Math.max(0, Math.min(effectiveLimit, irsLimit - counted));
}

/** A slot's room left for employee money (employer money that counts
 *  already taken off); 0 for the overflow target. */
export function remainingRoom(
  slot: Pick<
    AccumulationSlot,
    "category" | "irsLimit" | "effectiveLimit" | "employerMatch"
  >,
  employee: number,
): number {
  if (isOverflowTarget(slot.category)) return 0;
  return roundToCents(
    Math.max(
      0,
      employeeRoom(slot.category, slot.irsLimit, slot.effectiveLimit, {
        [slot.category]: slot.employerMatch,
      } as Record<AccountCategory, number>) - employee,
    ),
  );
}

/**
 * Route contributions through accounts for one year using waterfall mode.
 * Fills accounts in priority order up to effective limits.
 */
export function routeWaterfall(
  targetContribution: number,
  config: ResolvedAccumulationConfig,
  yearLimits: Record<AccountCategory, number>,
  employerMatch: Record<AccountCategory, number>,
): { slots: AccumulationSlot[]; warnings: string[] } {
  const warnings: string[] = [];

  if (!config.accountOrder || config.accountOrder.length === 0) {
    warnings.push(
      "No account order configured — contributions cannot be routed. " +
        "Configure account priority in contribution settings.",
    );
    return { slots: [], warnings };
  }

  let remaining = targetContribution;
  const slots: AccumulationSlot[] = [];

  // Track running totals for tax-type caps
  let totalRothUsed = 0;
  let totalTradUsed = 0;

  for (const category of config.accountOrder) {
    const irsLimit = yearLimits[category];
    const accountCap = config.accountCaps[category];
    const effectiveLimit = configGetEffectiveLimit(
      category,
      irsLimit,
      accountCap,
    );

    const room = employeeRoom(
      category,
      irsLimit,
      effectiveLimit,
      employerMatch,
    );

    let employeeContrib: number;
    if (isOverflowTarget(category)) {
      employeeContrib = roundToCents(remaining);
      remaining = 0;
    } else {
      employeeContrib = roundToCents(Math.min(remaining, room));
      remaining = roundToCents(remaining - employeeContrib);
    }

    // Apply tax split within account
    const rothFrac = getRothFraction(category, config.taxSplits);
    let rothContrib = roundToCents(employeeContrib * rothFrac);
    let tradContrib = roundToCents(employeeContrib - rothContrib);

    // Check cross-account tax-type caps
    let cappedByTaxType = false;
    const rothCap = config.taxTypeCaps.roth;
    if (rothCap !== null && totalRothUsed + rothContrib > rothCap) {
      const allowed = roundToCents(Math.max(0, rothCap - totalRothUsed));
      const excess = roundToCents(rothContrib - allowed);
      rothContrib = allowed;
      // Excess Roth shifts to Traditional within same account
      tradContrib = roundToCents(tradContrib + excess);
      cappedByTaxType = true;
      warnings.push(
        `Roth cap ($${rothCap.toLocaleString()}) hit — ` +
          `$${excess.toLocaleString()} shifted to Traditional in ${category}`,
      );
    }
    const tradCap = config.taxTypeCaps.traditional;
    if (tradCap !== null && totalTradUsed + tradContrib > tradCap) {
      const allowed = roundToCents(Math.max(0, tradCap - totalTradUsed));
      const excess = roundToCents(tradContrib - allowed);
      tradContrib = allowed;
      // Excess Traditional shifts to Roth within same account
      rothContrib = roundToCents(rothContrib + excess);
      cappedByTaxType = true;
      warnings.push(
        `Traditional cap ($${tradCap.toLocaleString()}) hit — ` +
          `$${excess.toLocaleString()} shifted to Roth in ${category}`,
      );
    }

    // Recalculate total after tax-type cap adjustments
    employeeContrib = roundToCents(rothContrib + tradContrib);

    totalRothUsed += rothContrib;
    totalTradUsed += tradContrib;

    const cappedByAccount = accountCap !== null && accountCap < irsLimit;
    const overflowAmount = isOverflowTarget(category)
      ? 0
      : roundToCents(Math.max(0, targetContribution - room - remaining));

    slots.push({
      category,
      irsLimit,
      effectiveLimit: isOverflowTarget(category) ? 0 : effectiveLimit,
      employerMatch: employerMatch[category],
      employeeContrib,
      rothContrib,
      traditionalContrib: tradContrib,
      remainingSpace: isOverflowTarget(category)
        ? 0
        : roundToCents(room - employeeContrib),
      cappedByAccount,
      cappedByTaxType,
      overflowAmount,
    });

    if (cappedByAccount) {
      warnings.push(
        `${category} capped at $${accountCap!.toLocaleString()} ` +
          `(IRS limit: $${irsLimit.toLocaleString()})`,
      );
    }
  }

  // Ensure brokerage catches remaining if not in order
  const hasBrokerage = slots.some((s) => isOverflowTarget(s.category));
  if (!hasBrokerage && remaining > 0) {
    slots.push({
      category: "brokerage",
      irsLimit: 0,
      effectiveLimit: 0,
      employerMatch: employerMatch.brokerage,
      employeeContrib: roundToCents(remaining),
      rothContrib: 0,
      traditionalContrib: 0,
      remainingSpace: 0,
      cappedByAccount: false,
      cappedByTaxType: false,
      overflowAmount: 0,
    });
    remaining = 0;
  }

  return { slots, warnings };
}

/**
 * Route contributions through accounts for one year using percentage mode.
 * Splits by configured percentages, then redistributes excess from capped accounts.
 */
export function routePercentage(
  targetContribution: number,
  config: ResolvedAccumulationConfig,
  yearLimits: Record<AccountCategory, number>,
  employerMatch: Record<AccountCategory, number>,
): { slots: AccumulationSlot[]; warnings: string[] } {
  const warnings: string[] = [];

  // Track running totals for tax-type caps
  let totalRothUsed = 0;
  let totalTradUsed = 0;

  // First pass: allocate by percentage, clamped to effective limits
  const allocations: {
    category: AccountCategory;
    requested: number;
    allocated: number;
    overflow: number;
    percent: number;
  }[] = [];
  let totalOverflow = 0;

  for (const category of ACCOUNT_CATEGORIES) {
    const percent = config.accountSplits[category] ?? 0;
    const requested = roundToCents(targetContribution * percent);
    const irsLimit = yearLimits[category];
    const accountCap = config.accountCaps[category];
    const effectiveLimit = configGetEffectiveLimit(
      category,
      irsLimit,
      accountCap,
    );

    const allocated = isOverflowTarget(category)
      ? requested
      : Math.min(
          requested,
          employeeRoom(category, irsLimit, effectiveLimit, employerMatch),
        );
    const overflow = roundToCents(requested - allocated);
    totalOverflow += overflow;

    allocations.push({
      category,
      requested,
      allocated: roundToCents(allocated),
      overflow,
      percent,
    });

    if (overflow >= OVERFLOW_TOLERANCE && !isOverflowTarget(category)) {
      const capLabel =
        accountCap !== null && accountCap < irsLimit
          ? `account cap $${accountCap.toLocaleString()}`
          : `IRS limit $${irsLimit.toLocaleString()}`;
      warnings.push(
        `${category}: $${overflow.toLocaleString()} overflow (${capLabel} exceeded)`,
      );
    }
  }

  // Second pass: redistribute overflow proportionally to accounts with remaining space
  if (totalOverflow > 0) {
    let redistributed = 0;
    const uncapped = allocations.filter((a) => {
      if (isOverflowTarget(a.category)) return true;
      const irsLimit = yearLimits[a.category];
      const accountCap = config.accountCaps[a.category];
      const effectiveLimit = configGetEffectiveLimit(
        a.category,
        irsLimit,
        accountCap,
      );
      return (
        a.allocated <
        employeeRoom(a.category, irsLimit, effectiveLimit, employerMatch)
      );
    });

    const uncappedTotalPercent = uncapped.reduce((s, a) => s + a.percent, 0);

    for (const a of uncapped) {
      const share =
        uncappedTotalPercent > 0
          ? roundToCents(totalOverflow * (a.percent / uncappedTotalPercent))
          : roundToCents(totalOverflow / uncapped.length);

      if (isOverflowTarget(a.category)) {
        a.allocated = roundToCents(a.allocated + share);
        redistributed += share;
      } else {
        const irsLimit = yearLimits[a.category];
        const accountCap = config.accountCaps[a.category];
        const effectiveLimit = configGetEffectiveLimit(
          a.category,
          irsLimit,
          accountCap,
        );
        const canAbsorb = roundToCents(
          employeeRoom(a.category, irsLimit, effectiveLimit, employerMatch) -
            a.allocated,
        );
        const absorbed = Math.min(share, canAbsorb);
        a.allocated = roundToCents(a.allocated + absorbed);
        redistributed += absorbed;
      }
    }

    // Any remaining goes to brokerage
    const stillRemaining = roundToCents(totalOverflow - redistributed);
    if (stillRemaining > 0) {
      const brokerageAlloc = allocations.find((a) =>
        isOverflowTarget(a.category),
      );
      if (brokerageAlloc) {
        brokerageAlloc.allocated = roundToCents(
          brokerageAlloc.allocated + stillRemaining,
        );
      } else {
        allocations.push({
          category: "brokerage",
          requested: 0,
          allocated: stillRemaining,
          overflow: 0,
          percent: 0,
        });
      }
    }
  }

  // Build slots with tax split
  const slots: AccumulationSlot[] = allocations.map((a) => {
    const irsLimit = yearLimits[a.category];
    const accountCap = config.accountCaps[a.category];
    const effectiveLimit = isOverflowTarget(a.category)
      ? 0
      : configGetEffectiveLimit(a.category, irsLimit, accountCap);

    const rothFrac = getRothFraction(a.category, config.taxSplits);
    let rothContrib = roundToCents(a.allocated * rothFrac);
    let tradContrib = roundToCents(a.allocated - rothContrib);

    // Check cross-account tax-type caps
    let cappedByTaxType = false;
    const rothCap = config.taxTypeCaps.roth;
    if (rothCap !== null && totalRothUsed + rothContrib > rothCap) {
      const allowed = roundToCents(Math.max(0, rothCap - totalRothUsed));
      const excess = roundToCents(rothContrib - allowed);
      rothContrib = allowed;
      tradContrib = roundToCents(tradContrib + excess);
      cappedByTaxType = true;
    }
    const tradCap = config.taxTypeCaps.traditional;
    if (tradCap !== null && totalTradUsed + tradContrib > tradCap) {
      const allowed = roundToCents(Math.max(0, tradCap - totalTradUsed));
      const excess = roundToCents(tradContrib - allowed);
      tradContrib = allowed;
      rothContrib = roundToCents(rothContrib + excess);
      cappedByTaxType = true;
    }

    totalRothUsed += rothContrib;
    totalTradUsed += tradContrib;

    return {
      category: a.category,
      irsLimit,
      effectiveLimit,
      employerMatch: employerMatch[a.category],
      employeeContrib: roundToCents(rothContrib + tradContrib),
      rothContrib,
      traditionalContrib: tradContrib,
      remainingSpace: remainingRoom(
        {
          category: a.category,
          irsLimit,
          effectiveLimit,
          employerMatch: employerMatch[a.category],
        },
        a.allocated,
      ),
      cappedByAccount: accountCap !== null && accountCap < irsLimit,
      cappedByTaxType,
      overflowAmount: a.overflow,
    };
  });

  return { slots, warnings };
}

/** What the IRS-limit caps run on for one projected year. */
type YearCapInput = {
  /** Limits already grown to the year; taxYear = the year (Dec-31 ages). */
  ctx: Omit<CapContext, "people">;
  people: readonly { id: number; birthYear: number | null }[];
  /** The year's employer money per category — the same dollars the engine
   *  credits; each spec holds its `employerShare` of it against the limit. */
  employerMatch: Record<AccountCategory, number>;
  /** Each person's projected pay for the year (bounds an IRA); null when
   *  the engine doesn't track pay per person. */
  wagesByPerson: ReadonlyMap<number, number> | null;
};

type CappedSpecs = {
  /** Per spec, in spec order. */
  capped: CappedContribution[];
  groupLimits: Map<string, number>;
};

/**
 * Cap one year's projected spec amounts per person through the shared
 * contribution-caps module (spec index = row id).
 */
export function capSpecs(
  specs: readonly ContributionSpec[],
  amounts: {
    projectedSalary: number;
    salaryBase: number;
    limitGrowthFactor: number;
  },
  year: YearCapInput,
): CappedSpecs {
  const rows: CapRow[] = specs.map((spec, i) => ({
    id: i,
    personId: spec.personId ?? null,
    accountType: spec.category,
    hsaCoverageType: spec.hsaCoverageType ?? null,
    regularAnnual: roundToCents(projectSpecAmount(spec, amounts)),
    bonusAnnual: 0,
    employerAnnual:
      (spec.employerShare ?? 0) * year.employerMatch[spec.category],
    // Pre-tax and HSA payroll money is left out of W-2 wages.
    reducesCompensation:
      getAccountTypeConfig(spec.category).isPayrollDeductible &&
      (isPreTaxTreatment(spec.taxTreatment) ||
        isHsaTreatment(spec.taxTreatment)),
  }));
  const { byRow, groupLimits } = capContributionsByLimitGroup(rows, {
    ...year.ctx,
    people: year.people.map((p) => ({
      ...p,
      wages: year.wagesByPerson?.get(p.id) ?? null,
    })),
  });
  return { capped: rows.map((r) => byRow.get(r.id)!), groupLimits };
}

/**
 * Each category's slot limit from its group's household limit, every
 * shared limit counted once: split across the group's categories in
 * proportion to their employee money, room left over to the group's own
 * category (the leader).
 */
export function slotLimits(
  groupLimits: ReadonlyMap<string, number>,
  employeeByCategory: Partial<Record<AccountCategory, number>>,
): Record<AccountCategory, number> {
  const out = buildCategoryRecord(() => 0);
  const byGroup = new Map<string, AccountCategory[]>();
  for (const cat of categoriesWithIrsLimit()) {
    const group = getLimitGroup(cat)!;
    byGroup.set(group, [...(byGroup.get(group) ?? []), cat]);
  }
  for (const [group, cats] of byGroup) {
    const limit = groupLimits.get(group) ?? 0;
    const leader = cats.find((c) => c === group) ?? cats[0]!;
    const money = (c: AccountCategory) =>
      Math.max(0, employeeByCategory[c] ?? 0);
    const total = sumBy(cats, money);
    for (const c of cats)
      out[c] = roundToCents(
        total >= limit && total > 0
          ? (limit * money(c)) / total
          : c === leader
            ? limit - (total - money(leader))
            : money(c),
      );
  }
  return out;
}

/**
 * Route one year's contributions from per-account specs already capped
 * per person at the IRS limits (capSpecs): over-limit money overflows to
 * brokerage, then the household's own account caps apply, also
 * overflowing to brokerage. A category's Roth share and Portfolio part
 * come from the capped amounts.
 */
export function routeFromSpecs(
  specs: readonly ContributionSpec[],
  capped: CappedSpecs,
  yearLimits: Record<AccountCategory, number>,
  employerMatch: Record<AccountCategory, number>,
  config: ResolvedAccumulationConfig,
): { slots: AccumulationSlot[]; warnings: string[]; totalOverflow: number } {
  const warnings: string[] = [];
  const employee = buildCategoryRecord(() => 0);
  const roth = buildCategoryRecord(() => 0);
  const portfolio = buildCategoryRecord(() => 0);
  const overflow = buildCategoryRecord(() => 0);
  const overNames = buildCategoryRecord(() => new Set<string>());

  specs.forEach((spec, i) => {
    const c = capped.capped[i]!;
    employee[spec.category] += c.cappedAnnual;
    if (isTaxFree(spec.taxTreatment)) roth[spec.category] += c.cappedAnnual;
    if (!isRetirementMoney(spec.parentCategory))
      portfolio[spec.category] += c.cappedAnnual;
    if (c.overBy > 0) {
      overflow[spec.category] += c.overBy;
      overNames[spec.category].add(spec.ownerName ?? "joint");
    }
  });
  // A category's Roth share is fixed before any cut below.
  const rothFrac = Object.fromEntries(
    ACCOUNT_CATEGORIES.map((cat) => [
      cat,
      employee[cat] > 0
        ? roth[cat] / employee[cat]
        : getRothFraction(cat, config.taxSplits),
    ]),
  ) as Record<AccountCategory, number>;

  let totalOverflow = 0;
  const spill = (cat: AccountCategory, amount: number) => {
    employee.brokerage += amount;
    totalOverflow += amount;
    return roundToCents(amount);
  };
  // IRS limits, per person (already capped): every cut cent goes to
  // brokerage; only a cut of a dollar or more is worth a warning.
  for (const cat of categoriesWithIrsLimit()) {
    if (overflow[cat] <= 0) continue;
    const amount = spill(cat, overflow[cat]);
    if (amount < OVERFLOW_TOLERANCE) continue;
    warnings.push(
      `${getAccountTypeConfig(cat).displayLabel.toUpperCase()} contributions over the IRS limit ` +
        `(${[...overNames[cat]].join(", ")}) — $${amount.toLocaleString()} overflow → brokerage`,
    );
  }
  // The household's own account caps.
  for (const cat of categoriesWithIrsLimit()) {
    const accountCap = config.accountCaps[cat];
    if (accountCap === null || accountCap === undefined) continue;
    const excess = roundToCents(employee[cat] - accountCap);
    if (excess < OVERFLOW_TOLERANCE) continue;
    employee[cat] = accountCap;
    overflow[cat] += excess;
    const amount = spill(cat, excess);
    warnings.push(
      `${getAccountTypeConfig(cat).displayLabel.toUpperCase()} contributions exceed account limit ` +
        `$${accountCap.toLocaleString()} — $${amount.toLocaleString()} overflow → brokerage`,
    );
  }

  const slots: AccumulationSlot[] = [];
  for (const cat of ACCOUNT_CATEGORIES) {
    const emp = employee[cat];
    const match = employerMatch[cat];
    if (emp <= 0 && match <= 0) continue;
    const irsLimit = yearLimits[cat];
    const accountCap = config.accountCaps[cat];
    const effectiveLimit = isOverflowTarget(cat)
      ? 0
      : configGetEffectiveLimit(cat, irsLimit, accountCap);
    const rothContrib = roundToCents(emp * rothFrac[cat]);
    slots.push({
      category: cat,
      irsLimit,
      effectiveLimit,
      employerMatch: match,
      employeeContrib: roundToCents(emp),
      rothContrib,
      traditionalContrib: roundToCents(emp - rothContrib),
      remainingSpace: remainingRoom(
        { category: cat, irsLimit, effectiveLimit, employerMatch: match },
        emp,
      ),
      cappedByAccount: accountCap !== null && accountCap < irsLimit,
      cappedByTaxType: false,
      overflowAmount: roundToCents(overflow[cat]),
      portfolioContrib: roundToCents(Math.min(portfolio[cat], emp)),
    });
  }

  return { slots, warnings, totalOverflow: roundToCents(totalOverflow) };
}
