/**
 * Recommends one withdrawal strategy with a rationale the UI shows as "Recommended for your plan":
 * a heuristic starting point for first-time users, freely overridden.
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
 * Recommend a withdrawal strategy by horizon: ≥ 30 years Guyton-Klinger; 20–29 Vanguard Dynamic
 * with a linked budget, else Guyton-Klinger; < 20 Fixed.
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
        "start from the withdrawal rate you choose, then raise spending " +
        "after strong years and cut it after weak ones. That lowers " +
        "sequence-of-returns risk compared to Fixed, at the cost of some " +
        "years with less to spend.",
    };
  }

  if (horizon >= 20 && plan.hasBudgetLink) {
    return {
      strategy: "vanguard_dynamic",
      label: "Vanguard Dynamic Spending",
      rationale:
        "You have a budget linked and a 20–30 year horizon, so Vanguard " +
        "Dynamic Spending is a steady place to start: each year's " +
        "withdrawal follows the portfolio, but can rise or fall only so " +
        "far from last year's spending.",
    };
  }

  if (horizon >= 20) {
    return {
      strategy: "guyton_klinger",
      label: "Guyton-Klinger guardrails",
      rationale:
        "For a 20–30 year horizon, Guyton-Klinger guardrails balance " +
        "simplicity with resilience to sequence-of-returns risk. With a " +
        "budget profile linked, Vanguard Dynamic Spending is suggested " +
        "instead.",
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
