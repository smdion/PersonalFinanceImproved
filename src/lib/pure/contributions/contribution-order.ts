import type { AccountCategory } from "@/lib/config/account-types";
import { categoriesWithIrsLimit } from "@/lib/config/account-types";

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
 * The validator does NOT enforce the exact order. It flags two specific
 * mistakes the audit identified:
 *   - Brokerage / taxable accounts come BEFORE any tax-advantaged account
 *   - HSA appears AFTER any non-HSA tax-advantaged account
 *
 * Both are common foot-guns for users who set up the order without thinking
 * about it. The warnings link to a help doc explaining the rationale.
 */
export function validateContributionOrder(
  order: readonly string[],
): ContributionOrderWarning[] {
  const warnings: ContributionOrderWarning[] = [];
  if (order.length === 0) return warnings;

  // Find the first taxable / overflow position. If a tax-advantaged
  // category comes after it, the user is filling taxable before tax-
  // advantaged — flag it.
  let firstOverflowIndex = -1;
  for (let i = 0; i < order.length; i++) {
    const cat = order[i]!;
    if (!categoriesWithIrsLimit().includes(cat as AccountCategory)) {
      // brokerage or other no-IRS-limit category
      if (firstOverflowIndex === -1) firstOverflowIndex = i;
    }
  }

  if (firstOverflowIndex >= 0) {
    // Any tax-advantaged category appearing AFTER the first overflow position
    // means the user is filling taxable first.
    for (let i = firstOverflowIndex + 1; i < order.length; i++) {
      const cat = order[i]!;
      if (categoriesWithIrsLimit().includes(cat as AccountCategory)) {
        warnings.push({
          severity: "warn",
          category: cat,
          position: i,
          message:
            `${cat} (tax-advantaged) appears after ${order[firstOverflowIndex]} ` +
            `in your contribution order. Most CFP guidance recommends filling ` +
            `tax-advantaged accounts before taxable / brokerage to maximize ` +
            `tax savings. Move ${cat} earlier in the list, or document why ` +
            `your situation differs.`,
        });
      }
    }
  }

  // HSA-specific check: HSA has the best tax treatment (triple-advantaged).
  // If HSA appears after a non-HSA tax-advantaged category, flag it.
  const hsaIndex = order.indexOf("hsa");
  if (hsaIndex > 0) {
    const hasEarlierTaxAdvantaged = order.slice(0, hsaIndex).some(
      (c) =>
        // lint-violation-ok: this validator IS the predicate for HSA-specific
        // ordering, intentionally referring to the category by name
        c !== "hsa" && categoriesWithIrsLimit().includes(c as AccountCategory),
    );
    if (hasEarlierTaxAdvantaged) {
      warnings.push({
        severity: "info",
        category: "hsa",
        position: hsaIndex,
        message:
          "HSA appears after another tax-advantaged account in your order. " +
          "HSAs have the best tax treatment of any account type (triple " +
          "tax-advantaged: pre-tax in, tax-free growth, tax-free out for " +
          "qualified medical expenses). Consider moving HSA earlier.",
      });
    }
  }

  return warnings;
}
