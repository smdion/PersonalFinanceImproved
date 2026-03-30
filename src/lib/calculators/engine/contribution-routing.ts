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
import { roundToCents } from "../../utils/math";
import {
  getRothFraction as configGetRothFraction,
  getAllCategories,
  getAccountTypeConfig,
  getEffectiveLimit as configGetEffectiveLimit,
  isOverflowTarget,
  categoriesWithIrsLimit,
  buildCategoryRecord,
  isTaxFree,
} from "../../config/account-types";
import { OVERFLOW_TOLERANCE } from "../../constants";

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

    let employeeContrib: number;
    if (isOverflowTarget(category)) {
      employeeContrib = roundToCents(remaining);
      remaining = 0;
    } else {
      employeeContrib = roundToCents(Math.min(remaining, effectiveLimit));
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
      : roundToCents(
          Math.max(0, targetContribution - effectiveLimit - remaining),
        );

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
        : roundToCents(effectiveLimit - employeeContrib),
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
    pct: number;
  }[] = [];
  let totalOverflow = 0;

  for (const category of ACCOUNT_CATEGORIES) {
    const pct = config.accountSplits[category] ?? 0;
    const requested = roundToCents(targetContribution * pct);
    const irsLimit = yearLimits[category];
    const accountCap = config.accountCaps[category];
    const effectiveLimit = configGetEffectiveLimit(
      category,
      irsLimit,
      accountCap,
    );

    const allocated = isOverflowTarget(category)
      ? requested
      : Math.min(requested, effectiveLimit);
    const overflow = roundToCents(requested - allocated);
    totalOverflow += overflow;

    allocations.push({
      category,
      requested,
      allocated: roundToCents(allocated),
      overflow,
      pct,
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
      return a.allocated < effectiveLimit;
    });

    const uncappedTotalPct = uncapped.reduce((s, a) => s + a.pct, 0);

    for (const a of uncapped) {
      const share =
        uncappedTotalPct > 0
          ? roundToCents(totalOverflow * (a.pct / uncappedTotalPct))
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
        const canAbsorb = roundToCents(effectiveLimit - a.allocated);
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
          pct: 0,
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
      remainingSpace: isOverflowTarget(a.category)
        ? 0
        : roundToCents(effectiveLimit - a.allocated),
      cappedByAccount: accountCap !== null && accountCap < irsLimit,
      cappedByTaxType,
      overflowAmount: a.overflow,
    };
  });

  return { slots, warnings };
}

/**
 * Route contributions for years 1+ using per-account specs from the DB.
 *
 * Each account computes its own contribution based on its method:
 * - percent_of_salary: projectedSalary × rate, capped at IRS limit
 * - fixed_per_period / fixed_monthly: base amount grown by IRS limit growth rate
 *
 * Tax-advantaged accounts that exceed their IRS limit overflow to brokerage.
 * Brokerage/ESPP accounts have no IRS cap.
 */
export function routeFromSpecs(
  specs: ContributionSpec[],
  projectedSalary: number,
  baseSalary: number,
  yearLimits: Record<AccountCategory, number>,
  employerMatch: Record<AccountCategory, number>,
  limitGrowthFactor: number,
  config: ResolvedAccumulationConfig,
): { slots: AccumulationSlot[]; warnings: string[]; totalOverflow: number } {
  const warnings: string[] = [];

  // Aggregate contributions by category (multiple accounts can share a category)
  const byCategory: Record<
    AccountCategory,
    {
      employee: number;
      overflow: number;
      specs: { name: string; amount: number; method: string }[];
    }
  > = buildCategoryRecord(() => ({
    employee: 0,
    overflow: 0,
    specs: [] as { name: string; amount: number; method: string }[],
  }));

  // Compute each account's projected contribution
  for (const spec of specs) {
    let projected: number;
    if (spec.method === "percent_of_salary") {
      // Use salaryFraction so multi-job households don't inflate per-account contributions
      projected = roundToCents(
        projectedSalary * spec.salaryFraction * spec.value,
      );
    } else if (spec.contributionScaling === "fixed_amount") {
      // Fixed-amount specs use limit growth only — independent of salary changes
      projected = roundToCents(spec.baseAnnual * limitGrowthFactor);
    } else if (
      getAccountTypeConfig(spec.category).fixedContribScalesWithSalary
    ) {
      // Fixed contributions that scale with salary growth (no IRS limit to track)
      const salaryGrowthFactor =
        baseSalary > 0 ? projectedSalary / baseSalary : 1;
      projected = roundToCents(spec.baseAnnual * salaryGrowthFactor);
    } else {
      // Tax-advantaged fixed contributions (e.g. HSA): grow with IRS limit growth
      projected = roundToCents(spec.baseAnnual * limitGrowthFactor);
    }
    byCategory[spec.category].specs.push({
      name: spec.name,
      amount: projected,
      method: spec.method,
    });
    byCategory[spec.category].employee += projected;
  }

  // Apply IRS limits to tax-advantaged accounts, overflow to brokerage
  let totalOverflow = 0;
  for (const cat of categoriesWithIrsLimit()) {
    const irsLimit = yearLimits[cat];
    const accountCap = config.accountCaps[cat];
    const effectiveLimit = Math.min(irsLimit, accountCap ?? Infinity);
    const raw = byCategory[cat].employee;

    if (raw > effectiveLimit) {
      const overflow = roundToCents(raw - effectiveLimit);
      if (overflow >= OVERFLOW_TOLERANCE) {
        byCategory[cat].employee = roundToCents(effectiveLimit);
        byCategory[cat].overflow = overflow;
        byCategory.brokerage.employee += overflow;
        totalOverflow += overflow;

        const specNames = byCategory[cat].specs.map((s) => s.name).join(" + ");
        warnings.push(
          `${getAccountTypeConfig(cat).displayLabel.toUpperCase()} contributions (${specNames}: $${raw.toLocaleString()}) ` +
            `exceed ${irsLimit === effectiveLimit ? "IRS" : "account"} limit ` +
            `$${effectiveLimit.toLocaleString()} — ` +
            `$${overflow.toLocaleString()} overflow → brokerage`,
        );
      }
    }
  }

  // Build slots
  const slots: AccumulationSlot[] = [];
  for (const cat of ACCOUNT_CATEGORIES) {
    const employee = byCategory[cat].employee;
    const match = employerMatch[cat];
    if (employee <= 0 && match <= 0) continue;

    const irsLimit = yearLimits[cat];
    const accountCap = config.accountCaps[cat];
    const effectiveLimit = isOverflowTarget(cat)
      ? 0
      : configGetEffectiveLimit(cat, irsLimit, accountCap);

    // Determine Roth fraction from the specs' tax treatments for this category
    const catSpecs = specs.filter((s) => s.category === cat);
    let rothFrac: number;
    if (catSpecs.length > 0) {
      const specProjection = (s: (typeof catSpecs)[number]) => {
        if (s.method === "percent_of_salary")
          return projectedSalary * s.salaryFraction * s.value;
        if (getAccountTypeConfig(s.category).fixedContribScalesWithSalary) {
          const sgf = baseSalary > 0 ? projectedSalary / baseSalary : 1;
          return s.baseAnnual * sgf;
        }
        return s.baseAnnual * limitGrowthFactor;
      };
      const rothAmount = catSpecs
        .filter((s) => isTaxFree(s.taxTreatment))
        .reduce((sum, s) => sum + specProjection(s), 0);
      const totalAmount = catSpecs.reduce(
        (sum, s) => sum + specProjection(s),
        0,
      );
      rothFrac =
        totalAmount > 0
          ? rothAmount / totalAmount
          : getRothFraction(cat, config.taxSplits);
    } else {
      // Category has no specs (e.g. brokerage from overflow only)
      rothFrac = getRothFraction(cat, config.taxSplits);
    }

    const rothContrib = roundToCents(employee * rothFrac);
    const tradContrib = roundToCents(employee - rothContrib);

    slots.push({
      category: cat,
      irsLimit,
      effectiveLimit,
      employerMatch: match,
      employeeContrib: roundToCents(employee),
      rothContrib,
      traditionalContrib: tradContrib,
      remainingSpace: isOverflowTarget(cat)
        ? 0
        : roundToCents(Math.max(0, effectiveLimit - employee)),
      cappedByAccount: accountCap !== null && accountCap < irsLimit,
      cappedByTaxType: false,
      overflowAmount: byCategory[cat].overflow,
    });
  }

  return { slots, warnings, totalOverflow };
}
