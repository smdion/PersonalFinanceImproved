/**
 * Withdrawal strategy recommendation.
 *
 * Ledgr offers 6+ withdrawal strategies side-by-side without flagging
 * which one fits the user's plan. This is "analysis paralysis"
 * — without guidance, users either stick with a default (status quo bias)
 * or pick randomly. This module returns a single recommendation with a
 * rationale string the UI can render as a "Recommended for your plan"
 * highlight.
 *
 * The recommendation is heuristic, not prescriptive. Users override
 * freely. The goal is to give first-time users a defensible starting
 * point, not to lock anyone in.
 *
 * This previously declared its own hyphenated `WithdrawalStrategy`
 * union, parallel to (and misspelled relative to) the canonical
 * underscored `WithdrawalStrategyType` in `withdrawal-strategies.ts` — a
 * "looks like one canonical value, isn't" gap. The one call site that read
 * `.strategy` bridged the two spellings with a manual translation map
 * (`RECOMMENDED_KEY_MAP` in
 * `retirement-profile-tab.tsx`); not a live bug (the map was complete and
 * correct), but a maintainability trap the next new strategy could fall
 * into. Now imports and reuses the canonical type directly.
 */
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

export interface WithdrawalStrategyRecommendation {
  strategy: WithdrawalStrategyType;
  /** UI label. */
  label: string;
  /** One-sentence rationale to render as a tooltip / callout body. */
  rationale: string;
}

export interface PlanCharacteristics {
  /** Years from retirement to plan end (e.g. 95 - retirementAge). */
  retirementHorizonYears: number;
  /** Whether the user has a budget linked (can stress-test essentials). */
  hasBudgetLink: boolean;
  /** Whether plan includes Social Security in retirement income. */
  hasSocialSecurity: boolean;
  /** True if portfolio is mostly tax-advantaged (low tax cost on withdrawals). */
  mostlyTaxAdvantaged: boolean;
}

/**
 * Recommend a withdrawal strategy based on plan characteristics.
 *
 * Decision tree (simple, defensible):
 *   - Horizon ≥ 30 years → Guyton-Klinger (dynamic guardrails handle
 *     sequence-of-returns risk over long horizons better than Fixed)
 *   - Horizon 20–29 years + budget linked → Vanguard Dynamic (lets
 *     users see real essential expenses driving withdrawals)
 *   - Horizon 20–29 years, no budget link → Guyton-Klinger
 *   - Horizon < 20 years → Fixed (4% rule is fine for short horizons,
 *     simpler is better)
 *
 * The default-good strategy for first-time users is always Guyton-Klinger
 * if no plan characteristics are available — it adapts to market conditions
 * better than Fixed and is well-studied (Trinity Study + cFIREsim both
 * validate it).
 */
export function recommendWithdrawalStrategy(
  plan: PlanCharacteristics,
): WithdrawalStrategyRecommendation {
  const horizon = plan.retirementHorizonYears;

  if (horizon >= 30) {
    return {
      strategy: "guyton_klinger",
      label: "Guyton-Klinger guardrails",
      rationale:
        "For your 30+ year retirement horizon, Guyton-Klinger guardrails " +
        "adapt spending up or down based on portfolio performance. Cuts " +
        "sequence-of-returns risk significantly compared to Fixed without " +
        "requiring you to pick a single safe withdrawal rate.",
    };
  }

  if (horizon >= 20 && plan.hasBudgetLink) {
    return {
      strategy: "vanguard_dynamic",
      label: "Vanguard Dynamic Spending",
      rationale:
        "You have a budget linked, so Vanguard Dynamic Spending can use " +
        "your real essential-expense floor as the lower guardrail. This " +
        "ties withdrawals to your actual spending rather than an abstract " +
        "rate.",
    };
  }

  if (horizon >= 20) {
    return {
      strategy: "guyton_klinger",
      label: "Guyton-Klinger guardrails",
      rationale:
        "For a 20–30 year horizon, Guyton-Klinger guardrails balance " +
        "simplicity with resilience to sequence-of-returns risk. Link a " +
        "budget profile to upgrade to Vanguard Dynamic, which uses your " +
        "real essential-expense floor.",
    };
  }

  return {
    strategy: "fixed",
    label: "Fixed (4% rule)",
    rationale:
      "For a sub-20-year horizon, the Fixed 4% rule is well-supported by " +
      "the Trinity Study and is the simplest place to start. Dynamic " +
      "strategies become valuable on longer horizons.",
  };
}
