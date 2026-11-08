import type { AccountCategory } from "@/lib/config/account-types";
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getDisplayConfig,
  isTripleTaxAdvantaged,
} from "@/lib/config/account-types";

/**
 * Severity of a contribution-order warning. UI surfaces these as
 * yellow callouts (not errors) — the user is allowed to override.
 */
type ContributionOrderWarning = {
  severity: "warn" | "info";
  /** The category that's out of place. */
  category: string;
  /** Position in the user's order (0-indexed). */
  position: number;
  /** Human-readable explanation. */
  message: string;
};

/**
 * Validate a user's accumulation order against the CFP Financial Order of
 * Operations heuristic. Returns warnings (never throws) so the user can
 * override if they have a good reason.
 *
 * The default-good order (per CFP best practice for high-savings households):
 *   1. Employer-match-eligible contributions (401k/403b up to match)
 *   2. HSA (triple tax advantage)
 *   3. Tax-advantaged retirement (Roth IRA, Traditional IRA, 401k beyond match)
 *   4. After-tax / brokerage (no tax advantage)
 *
 * It doesn't enforce the exact order; it flags two common mistakes:
 *   - Brokerage / taxable accounts come BEFORE any tax-advantaged account
 *   - A triple tax-advantaged type (HSA) comes AFTER another tax-advantaged one
 */
export function validateContributionOrder(
  order: readonly string[],
): ContributionOrderWarning[] {
  const warnings: ContributionOrderWarning[] = [];
  if (order.length === 0) return warnings;
  const taxAdvantagedTypes = categoriesWithIrsLimit();
  const taxAdvantaged: readonly string[] = taxAdvantagedTypes;

  // Find the first taxable / overflow position. If a tax-advantaged
  // category comes after it, the user is filling taxable before tax-
  // advantaged — flag it.
  const firstOverflow = order.find((c) => !taxAdvantaged.includes(c));

  if (firstOverflow !== undefined) {
    const overflow = getDisplayConfig(firstOverflow).displayLabel;
    order.forEach((cat, i) => {
      if (i > order.indexOf(firstOverflow) && taxAdvantaged.includes(cat)) {
        const label = getDisplayConfig(cat).displayLabel;
        warnings.push({
          severity: "warn",
          category: cat,
          position: i,
          message:
            `${label} (tax-advantaged) appears after ${overflow} in your ` +
            `contribution order. Filling tax-advantaged accounts before ` +
            `taxable ones usually saves more tax. Move ${label} earlier in ` +
            `the list, or document why your situation differs.`,
        });
      }
    });
  }

  // A triple tax-advantaged type belongs before every other tax-advantaged one.
  const triple = taxAdvantagedTypes.filter(isTripleTaxAdvantaged);
  for (const cat of triple) {
    const index = order.indexOf(cat);
    if (index <= 0) continue;
    const isOther = (c: AccountCategory) =>
      order.slice(0, index).includes(c) && !triple.includes(c);
    if (taxAdvantagedTypes.some(isOther)) {
      const label = getAccountTypeConfig(cat).displayLabel;
      warnings.push({
        severity: "info",
        category: cat,
        position: index,
        message:
          `${label} appears after another tax-advantaged account in your order. ` +
          `${label}s have the best tax treatment of any account type (triple ` +
          "tax-advantaged: pre-tax in, tax-free growth, tax-free out for " +
          `qualified medical expenses). Consider moving ${label} earlier.`,
      });
    }
  }

  return warnings;
}
