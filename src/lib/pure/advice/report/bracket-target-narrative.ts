/** Why this tax bracket target, with numbers from `BracketOptimizerResult` (as on the Taxes
 *  page); shared by the advisor report and the table tooltips. Without an optimizer result
 *  (loading, Waterfall mode, under 2 candidates) it explains qualitatively. */
import type {
  BracketOptimizerResult,
  BracketOptimizerCandidate,
} from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

const RATE_EPSILON = 0.0005;

function findCandidate(
  candidates: BracketOptimizerCandidate[],
  target: number,
): BracketOptimizerCandidate | undefined {
  return candidates.find((c) => Math.abs(c.target - target) < RATE_EPSILON);
}

/** This year's `bracketTraditionalCap` (dollar room left for Traditional withdrawals) and
 *  `taxableSS` (taxable Social Security in that bracket), plus the household's
 *  `standardDeduction`, which the engine output doesn't store per year. */
type BracketCeilingMathInput = {
  bracketTraditionalCap: number;
  taxableSS: number;
  standardDeduction?: number | null;
};

/**
 * The math behind `bracketTraditionalCap`: the bracket ceiling in gross-income terms (plus
 * the standard deduction) minus taxable Social Security. undefined without `standardDeduction`.
 */
export function describeBracketCeilingMath(
  currentTargetPercent: number,
  input?: BracketCeilingMathInput | null,
): string | undefined {
  if (!input || input.standardDeduction == null) return undefined;
  // The cap is clamped to >= 0 upstream, so when taxable SS alone exceeds the bracket
  // the true ceiling can't be recovered; state that fact instead of a number.
  if (input.bracketTraditionalCap <= 0 && input.taxableSS > 0) {
    return `Your taxable Social Security income alone (${formatCurrency(input.taxableSS)}) already fills the ${formatPercent(currentTargetPercent, 0)} bracket's room once your ${formatCurrency(input.standardDeduction)} standard deduction is factored in, leaving no room for Traditional withdrawals at this target.`;
  }
  const incomeCap = input.bracketTraditionalCap + input.taxableSS;
  const ssClause =
    input.taxableSS > 0
      ? ` ${formatCurrency(input.taxableSS)} of that room is already used by taxable Social Security this year, leaving ${formatCurrency(input.bracketTraditionalCap)} available for Traditional withdrawals.`
      : ` With no taxable Social Security this year, the full ${formatCurrency(input.bracketTraditionalCap)} is available for Traditional withdrawals.`;
  return `The ${formatPercent(currentTargetPercent, 0)} bracket's ceiling sits at about ${formatCurrency(incomeCap)} in gross income once your ${formatCurrency(input.standardDeduction)} standard deduction is factored in.${ssClause}`;
}

/** Qualitative-only fallback — the strategy's general rationale, no
 *  numbers, for when the optimizer result isn't available. */
export function describeBracketTargetQualitative(targetPct: number): string {
  return `This projection fills your Traditional withdrawals up to the ${formatPercent(
    targetPct,
    0,
  )} tax bracket before drawing from any other account. The idea: your Traditional balance will eventually be taxed one way or another — either you withdraw it (or convert it to Roth) at a rate you choose now, or the IRS forces it out later as a Required Minimum Distribution, taxed at whatever your bracket happens to be at that point (often higher, once RMDs stack on top of other income). Filling to ${formatPercent(
    targetPct,
    0,
  )} now uses up that tax bracket while you control the amount; stopping there instead of going further into the next bracket avoids paying a higher rate today for savings that may not materialize.`;
}

/**
 * The numeric explanation: lifetime-cost difference against neighboring candidate brackets,
 * flagging when the household's setting isn't the optimizer's recommendation.
 */
export function describeBracketTargetChoice(
  optimizer: BracketOptimizerResult | null | undefined,
  currentTargetPercent: number,
  ceilingMath?: BracketCeilingMathInput | null,
): string {
  const mathSentence = describeBracketCeilingMath(
    currentTargetPercent,
    ceilingMath,
  );
  const fallback = describeBracketTargetQualitative(currentTargetPercent);
  const fallbackWithMath = mathSentence
    ? `${fallback} ${mathSentence}`
    : fallback;
  if (!optimizer || optimizer.candidates.length < 2) return fallbackWithMath;

  const sorted = [...optimizer.candidates]
    .filter((c) => !c.depleted)
    .sort((a, b) => a.target - b.target);
  if (sorted.length < 2) return fallbackWithMath;

  const current = findCandidate(sorted, currentTargetPercent);
  if (!current) return fallbackWithMath;

  const cheapest = sorted.reduce((best, c) =>
    c.netCost < best.netCost ? c : best,
  );
  const isCheapest = Math.abs(cheapest.target - current.target) < RATE_EPSILON;

  const index = sorted.indexOf(current);
  const lower = index > 0 ? sorted[index - 1] : undefined;
  const higher = index < sorted.length - 1 ? sorted[index + 1] : undefined;

  const parts: string[] = [
    `This projection fills your Traditional withdrawals up to the ${formatPercent(currentTargetPercent, 0)} tax bracket before drawing from any other account — your Traditional balance is taxed either at a rate you choose now, or later as a Required Minimum Distribution taxed at whatever bracket you're in then.`,
  ];
  if (mathSentence) parts.push(mathSentence);

  if (isCheapest) {
    parts.push(
      `Among the bracket targets this projection tested (your own real marginal rates), ${formatPercent(currentTargetPercent, 0)} is the lowest lifetime-cost choice.`,
    );
  } else {
    parts.push(
      `Among the bracket targets this projection tested, ${formatPercent(cheapest.target, 0)} scores as the lower-cost choice — about ${formatCurrency(current.netCost - cheapest.netCost)} less over your retirement than your current ${formatPercent(currentTargetPercent, 0)} target. Worth reviewing on the Taxes settings page.`,
    );
  }

  if (lower) {
    const delta = current.netCost - lower.netCost;
    parts.push(
      delta > 0
        ? `Filling only to ${formatPercent(lower.target, 0)} instead would cost about ${formatCurrency(delta)} less in tax today, but leaves more in Traditional accounts to be taxed later — worth it only if that later rate is expected to be lower.`
        : `Filling only to ${formatPercent(lower.target, 0)} instead would leave more in Traditional accounts to be taxed later without reducing today's tax cost — this projection's own numbers show that's not worth it.`,
    );
  }

  if (higher) {
    const delta = higher.netCost - current.netCost;
    parts.push(
      delta > 0
        ? `Filling further to ${formatPercent(higher.target, 0)} would cost about ${formatCurrency(delta)} more over your retirement — the extra tax paid now isn't offset by a large enough future benefit.`
        : `Filling further to ${formatPercent(higher.target, 0)} doesn't cost meaningfully more over your retirement, but doesn't save anything either.`,
    );
  }

  return parts.join(" ");
}

/** This year's capacity in the two zero-cost discretionary tiers
 *  (`rothBasisCapacity`/`brokerageZeroLtcgCapacity`), computed before the
 *  `discretionaryWithdrawalOrder` picks which drains first. */
type DiscretionaryCapacityInput = {
  rothBasisCapacity: number;
  /** Withdrawal dollars, not LTCG gains room: adjusted for the brokerage basis ratio
   *  (see `RankedWithdrawalTiers`). */
  brokerageZeroLtcgCapacity: number;
};

/**
 * This year's room, use and unused room in both zero-cost discretionary tiers, plus the order
 * setting. Numbers only, never a cause. undefined with no discretionary draw, or in an RMD
 * override year (capacities predate RMD enforcement and would overstate the room).
 */
export function describeDiscretionaryCapacityMath(
  capacities: DiscretionaryCapacityInput | undefined | null,
  tierBreakdown:
    | {
        source: "roth" | "brokerage" | "hsa";
        costRate: number;
        amount: number;
      }[]
    | undefined,
  discretionaryWithdrawalOrder: "roth_first" | "brokerage_first" | undefined,
  rmdOverrodeRouting: boolean | undefined,
): string | undefined {
  if (!capacities) return undefined;
  if (rmdOverrodeRouting) return undefined;
  if (!tierBreakdown || tierBreakdown.length === 0) return undefined;

  const { rothBasisCapacity, brokerageZeroLtcgCapacity } = capacities;
  if (rothBasisCapacity <= 0 && brokerageZeroLtcgCapacity <= 0) {
    return undefined;
  }

  // Numbers only, no cause: a per-category cap can cut a draw short of capacity.
  // lint-violation-ok: `source` is WithdrawalTier's cost-ranking kind, not an AccountCategory.
  const rothZeroUsedRaw = tierBreakdown
    .filter((t) => t.source === "roth" && t.costRate === 0)
    .reduce((s, t) => s + t.amount, 0);
  // Capped at rothBasisCapacity: a $0-cost Roth entry may be growth in the 0% bracket,
  // so "used" must not exceed the basis.
  const rothZeroUsed = Math.min(rothZeroUsedRaw, rothBasisCapacity);
  // lint-violation-ok: `source` is WithdrawalTier's kind, not an AccountCategory.
  const brokerageZeroUsed = tierBreakdown
    .filter((t) => t.source === "brokerage" && t.costRate === 0)
    .reduce((s, t) => s + t.amount, 0);

  const rothUnused = Math.max(0, rothBasisCapacity - rothZeroUsed);
  const brokerageUnused = Math.max(
    0,
    brokerageZeroLtcgCapacity - brokerageZeroUsed,
  );

  const parts: string[] = [
    `You had about ${formatCurrency(rothBasisCapacity)} of tax-free Roth money and ${formatCurrency(brokerageZeroLtcgCapacity)} you could have drawn from brokerage at 0% federal tax this year.`,
    `${formatCurrency(rothZeroUsed)} came from tax-free Roth and ${formatCurrency(brokerageZeroUsed)} from brokerage.`,
  ];

  const leftovers: string[] = [];
  if (rothUnused > 0)
    leftovers.push(`${formatCurrency(rothUnused)} of tax-free Roth`);
  if (brokerageUnused > 0) {
    leftovers.push(`${formatCurrency(brokerageUnused)} of brokerage's 0% room`);
  }
  if (leftovers.length > 0) {
    parts.push(`${leftovers.join(" and ")} went unused this year.`);
  }

  const orderLabel =
    discretionaryWithdrawalOrder === "brokerage_first"
      ? "Brokerage 0% room first"
      : "Roth basis first";
  parts.push(
    `Which drains first is controlled by your Discretionary Withdrawal Order setting (currently "${orderLabel}") on the Taxes settings page.`,
  );

  return parts.join(" ");
}
