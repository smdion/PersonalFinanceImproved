/** The IRS-limit card's auto-max: the room left under the limit and the
 *  contribution that fills it, in the account's own method. */
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

export type AutoMaxInput = {
  accountType: AccountCategory;
  contributionMethod: string;
  /** In the method's unit: percent, per paycheck, per month or per year. */
  currentValue: number;
  annualLimit: number | undefined;
  employerMatchAnnual: number;
  /** What the account's other accounts under the same limit put in a year. */
  siblingAnnualContributions: number;
  salary: number | undefined;
  periodsPerYear: number | undefined;
};

/** The contribution that fills the room left, beside the current one. */
export type AutoMaxTarget = {
  method:
    "percent_of_salary" | "fixed_per_period" | "fixed_monthly" | "fixed_annual";
  /** Each in the method's unit, and per year. */
  current: number;
  currentAnnual: number;
  target: number;
  targetAnnual: number;
  wouldChange: boolean;
};

export type AutoMaxView = {
  /** The account type has an IRS limit; without one there's no auto-max. */
  hasIrsLimit: boolean;
  /** The limit less the other accounts' and any counted match; 0 if none. */
  remainingLimit: number;
  /** Null when there's no room, or the method can't be sized. */
  target: AutoMaxTarget | null;
  /** The other accounts already use the whole limit. */
  limitUsedByOthers: boolean;
  /** What the current value comes to in a year, for the auto-maxed line. */
  currentAnnual: number;
};

/** Rounded down to the cent, so the target never passes the limit. */
const floorToCent = (amount: number) => Math.floor(amount * 100) / 100;

const FIXED_METHODS = [
  "fixed_per_period",
  "fixed_monthly",
  "fixed_annual",
] as const;

function sizeTarget(
  input: AutoMaxInput,
  remainingLimit: number,
): AutoMaxTarget | null {
  const { contributionMethod, currentValue: current, salary } = input;
  if (contributionMethod === "percent_of_salary" && salary && salary > 0) {
    const target = Math.floor((remainingLimit / salary) * 100);
    return {
      method: contributionMethod,
      current,
      currentAnnual: salary * (current / 100),
      target,
      targetAnnual: salary * (target / 100),
      wouldChange: target !== current,
    };
  }
  const method = FIXED_METHODS.find((m) => m === contributionMethod);
  const perYear =
    method === "fixed_per_period"
      ? input.periodsPerYear
      : method === "fixed_monthly"
        ? 12
        : 1;
  if (!method || !perYear) return null;
  const target =
    method === "fixed_annual"
      ? remainingLimit
      : floorToCent(remainingLimit / perYear);
  return {
    method,
    current,
    currentAnnual: current * perYear,
    target,
    targetAnnual: target * perYear,
    wouldChange: Math.abs(target - current) > 0.01,
  };
}

/** What the current value comes to in a year, in its method's unit. */
function annualOf(input: AutoMaxInput): number {
  const { contributionMethod, currentValue, salary, periodsPerYear } = input;
  if (contributionMethod === "percent_of_salary")
    return salary ? salary * (currentValue / 100) : 0;
  if (contributionMethod === "fixed_per_period")
    return currentValue * (periodsPerYear ?? Number.NaN); // no pay schedule: no figure
  if (contributionMethod === "fixed_monthly") return currentValue * 12;
  return currentValue;
}

/** The auto-max preview and target for one contribution. */
export function autoMaxView(input: AutoMaxInput): AutoMaxView {
  const { annualLimit, siblingAnnualContributions } = input;
  const category = input.accountType;
  const irsCategory = categoriesWithIrsLimit().includes(category);
  const matchCounts =
    irsCategory && getAccountTypeConfig(category).matchCountsTowardLimit;
  const employerToward = matchCounts ? input.employerMatchAnnual : 0;
  const hasLimit = annualLimit !== undefined && annualLimit > 0;
  const remainingLimit = hasLimit
    ? Math.max(0, annualLimit - siblingAnnualContributions - employerToward)
    : 0;
  return {
    hasIrsLimit: irsCategory,
    remainingLimit,
    target: remainingLimit > 0 ? sizeTarget(input, remainingLimit) : null,
    limitUsedByOthers:
      remainingLimit <= 0 &&
      hasLimit &&
      siblingAnnualContributions >= annualLimit,
    currentAnnual: annualOf(input),
  };
}
