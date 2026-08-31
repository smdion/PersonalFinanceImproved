/** "Why THIS tax bracket, not a lower or higher one" — the full, numeric
 *  version. Reads `BracketOptimizerResult` (the household's own real
 *  marginal bracket rates, each scored by lifetime tax cost —
 *  `withdrawal-bracket-optimizer.ts`), the same data already surfaced on
 *  the Taxes settings page, so this can never disagree with that
 *  recommendation. One shared function, used by both the advisor report
 *  and the interactive table/chart tooltips (projection-table-decum-row.tsx)
 *  — not two independently-worded explanations.
 *
 * Falls back to a qualitative-only explanation (no dollar comparison) when
 * the optimizer result isn't available yet (query still loading, disabled
 * under Waterfall mode, or fewer than 2 real candidates to compare) —
 * callers should still show SOMETHING useful, not nothing, while the
 * richer version loads in. */
import type {
  BracketOptimizerResult,
  BracketOptimizerCandidate,
} from "@/lib/calculators/withdrawal-bracket-optimizer";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

const RATE_EPSILON = 0.0005;

function findCandidate(
  candidates: BracketOptimizerCandidate[],
  target: number,
): BracketOptimizerCandidate | undefined {
  return candidates.find((c) => Math.abs(c.target - target) < RATE_EPSILON);
}

/** Inputs for `describeBracketCeilingMath` — the pieces
 *  `incomeCapForMarginalRate`/`routeWithdrawalsBracketFilling`
 *  (withdrawal-routing.ts, tax-estimation.ts) already computed for this
 *  year: `bracketTraditionalCap` (the resolved dollar room left for
 *  Traditional withdrawals — engine field of the same name) and
 *  `taxableSS` (the IRS-provisional-income taxable portion of Social
 *  Security already occupying part of that bracket). `standardDeduction`
 *  is the household's filing-status deduction (not stored per-year on the
 *  engine output — callers read it off the resolved settings/config). */
export type BracketCeilingMathInput = {
  bracketTraditionalCap: number;
  taxableSS: number;
  standardDeduction?: number | null;
};

/**
 * "What dollar ceiling, and how was it computed" — the actual math behind
 * `bracketTraditionalCap`: the bracket's ceiling in gross-income terms
 * (adjusted for the household's standard deduction, since the underlying
 * withholding-table threshold only embeds a smaller IRS worksheet offset —
 * see `incomeCapForMarginalRate`'s docblock, tax-estimation.ts), minus
 * whatever taxable Social Security already occupies. Requires
 * `standardDeduction` to say anything meaningful about the gross-income
 * figure — returns undefined without it rather than showing an
 * unexplained number.
 */
export function describeBracketCeilingMath(
  currentTargetPct: number,
  input?: BracketCeilingMathInput | null,
): string | undefined {
  if (!input || input.standardDeduction == null) return undefined;
  const incomeCap = input.bracketTraditionalCap + input.taxableSS;
  const ssClause =
    input.taxableSS > 0
      ? ` ${formatCurrency(input.taxableSS)} of that room is already used by taxable Social Security this year, leaving ${formatCurrency(input.bracketTraditionalCap)} available for Traditional withdrawals.`
      : ` With no taxable Social Security this year, the full ${formatCurrency(input.bracketTraditionalCap)} is available for Traditional withdrawals.`;
  return `The ${formatPercent(currentTargetPct, 0)} bracket's ceiling sits at about ${formatCurrency(incomeCap)} in gross income once your ${formatCurrency(input.standardDeduction)} standard deduction is factored in.${ssClause}`;
}

/** Qualitative-only fallback — the strategy's general rationale, no
 *  numbers, for when the optimizer result isn't available. */
export function describeBracketTargetQualitative(targetPct: number): string {
  return `This plan fills your Traditional withdrawals up to the ${formatPercent(
    targetPct,
    0,
  )} tax bracket before drawing from any other account. The idea: your Traditional balance will eventually be taxed one way or another — either you withdraw it (or convert it to Roth) at a rate you choose now, or the IRS forces it out later as a Required Minimum Distribution, taxed at whatever your bracket happens to be at that point (often higher, once RMDs stack on top of other income). Filling to ${formatPercent(
    targetPct,
    0,
  )} now uses up that tax bracket while you control the amount; stopping there instead of going further into the next bracket avoids paying a higher rate today for savings that may not materialize.`;
}

/**
 * The full, numeric explanation — names the actual lifetime-cost
 * difference against the neighboring candidate brackets, and flags when
 * the household's current setting ISN'T the optimizer's own
 * recommendation (a real, actionable fact this report/tooltip context
 * should surface, not just narrate the status quo as if it were optimal).
 */
export function describeBracketTargetChoice(
  optimizer: BracketOptimizerResult | null | undefined,
  currentTargetPct: number,
  ceilingMath?: BracketCeilingMathInput | null,
): string {
  const mathSentence = describeBracketCeilingMath(
    currentTargetPct,
    ceilingMath,
  );
  const fallback = describeBracketTargetQualitative(currentTargetPct);
  const fallbackWithMath = mathSentence
    ? `${fallback} ${mathSentence}`
    : fallback;
  if (!optimizer || optimizer.candidates.length < 2) return fallbackWithMath;

  const sorted = [...optimizer.candidates]
    .filter((c) => !c.depleted)
    .sort((a, b) => a.target - b.target);
  if (sorted.length < 2) return fallbackWithMath;

  const current = findCandidate(sorted, currentTargetPct);
  if (!current) return fallbackWithMath;

  const cheapest = sorted.reduce((best, c) =>
    c.netCost < best.netCost ? c : best,
  );
  const isCheapest = Math.abs(cheapest.target - current.target) < RATE_EPSILON;

  const idx = sorted.indexOf(current);
  const lower = idx > 0 ? sorted[idx - 1] : undefined;
  const higher = idx < sorted.length - 1 ? sorted[idx + 1] : undefined;

  const parts: string[] = [
    `This plan fills your Traditional withdrawals up to the ${formatPercent(currentTargetPct, 0)} tax bracket before drawing from any other account — your Traditional balance is taxed either at a rate you choose now, or later as a Required Minimum Distribution taxed at whatever bracket you're in then.`,
  ];
  if (mathSentence) parts.push(mathSentence);

  if (isCheapest) {
    parts.push(
      `Among the bracket targets this plan tested (your own real marginal rates), ${formatPercent(currentTargetPct, 0)} is the lowest lifetime-cost choice.`,
    );
  } else {
    parts.push(
      `Among the bracket targets this plan tested, ${formatPercent(cheapest.target, 0)} scores as the lower-cost choice — about ${formatCurrency(current.netCost - cheapest.netCost)} less over your plan than your current ${formatPercent(currentTargetPct, 0)} target. Worth reviewing on the Taxes settings page.`,
    );
  }

  if (lower) {
    const delta = current.netCost - lower.netCost;
    parts.push(
      delta > 0
        ? `Filling only to ${formatPercent(lower.target, 0)} instead would cost about ${formatCurrency(delta)} less in tax today, but leaves more in Traditional accounts to be taxed later — worth it only if that later rate is expected to be lower.`
        : `Filling only to ${formatPercent(lower.target, 0)} instead would leave more in Traditional accounts to be taxed later without reducing today's tax cost — this plan's own numbers show that's not worth it.`,
    );
  }

  if (higher) {
    const delta = higher.netCost - current.netCost;
    parts.push(
      delta > 0
        ? `Filling further to ${formatPercent(higher.target, 0)} would cost about ${formatCurrency(delta)} more over your plan — the extra tax paid now isn't offset by a large enough future benefit.`
        : `Filling further to ${formatPercent(higher.target, 0)} doesn't cost meaningfully more over your plan, but doesn't save anything either.`,
    );
  }

  return parts.join(" ");
}

/** Inputs for `describeDiscretionaryCapacityMath` — the two zero-cost
 *  discretionary tiers' real capacity this year
 *  (`EngineDecumulationYear.rothBasisCapacity`/`brokerageZeroLtcgCapacity`,
 *  a passthrough of `rankWithdrawalTiers`' `RankedWithdrawalTiers` —
 *  withdrawal-cost-ranking.ts), computed BEFORE the household's
 *  `discretionaryWithdrawalOrder` decides which drains first and before
 *  either is actually drawn from. */
export type DiscretionaryCapacityInput = {
  rothBasisCapacity: number;
  /** Withdrawal dollars, not raw LTCG gains room — already adjusted for
   *  brokerage's basis ratio (a $1 gain requires drawing more than $1 when
   *  part of the withdrawal is basis). See `RankedWithdrawalTiers`'s
   *  docblock for why this distinction matters. */
  brokerageZeroLtcgCapacity: number;
};

/**
 * "Why isn't brokerage draining before Roth" — the real dollar room in each
 * of the two zero-cost discretionary tiers this year, how much of each was
 * actually drawn, how much of each went unused, and the household's
 * current `discretionaryWithdrawalOrder` setting (found live, 2026-08-31:
 * a household's Traditional bracket target was crowding out brokerage's
 * 0%-LTCG room down to ~$0, so no order setting could have changed the
 * outcome that year — this function exists so the numbers are visible
 * instead of requiring a multi-message debugging session to work out by
 * hand).
 *
 * Deliberately states ONLY the numbers, never a causal claim about WHY a
 * tier stopped being drawn from (advisor review, 2026-08-31 — an earlier
 * draft inferred "ran out" from used === capacity, which is wrong whenever
 * a per-category `withdrawalAccountCap`/`rothTypeCap` cuts a draw short
 * before the tier's own household-wide capacity is reached; this function
 * has no way to distinguish that from genuine exhaustion, so it doesn't
 * claim to).
 *
 * Returns `undefined` when there's nothing meaningful to say: no
 * discretionary draw happened this year (`tierBreakdown` empty/undefined),
 * or `rmdOverrodeRouting` is true — the capacities here are snapshotted at
 * routing time, BEFORE RMD enforcement can force more Traditional income
 * than Phase 1 planned, so in an RMD-override year they'd overstate the
 * real 0%-LTCG room relative to what actually happened. A drawn-dollar
 * figure reads as history; a capacity figure reads as "you had this room
 * and didn't use it" — actively misleading if shown in that scenario.
 *
 * Deliberately does not re-explain the ACA/IRMAA tradeoff of the order
 * setting itself — that's already covered where the setting lives
 * (Retirement → Taxes in Retirement,
 * `src/components/retirement/sections/taxes.tsx`); this sticks to the
 * dollar math for THIS year.
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

  // Deliberately descriptive only, not causal (advisor review, 2026-08-31):
  // an earlier draft tried to say WHY a tier stopped ("ran out" / "covered
  // it on its own"), inferred from used === capacity — wrong whenever a
  // per-category withdrawalAccountCap or rothTypeCap cut a draw short
  // before the tier's own household-wide capacity was reached. This states
  // only the numbers, never the mechanism.
  //
  // lint-violation-ok: `source` here is WithdrawalTier's cost-ranking kind
  // (tierBreakdown's own field), not an AccountCategory — same false
  // positive as describeTierRate's note in withdrawal-strategy-narrative.ts.
  const rothZeroUsedRaw = tierBreakdown
    .filter((t) => t.source === "roth" && t.costRate === 0)
    .reduce((s, t) => s + t.amount, 0);
  // Clamped to rothBasisCapacity: a $0-cost Roth entry can be basis OR
  // growth priced at a genuinely 0% marginal ordinary rate (household in
  // the 0% bracket) — summing both without a ceiling could report "used"
  // exceeding the household's actual Roth basis, a self-contradicting
  // number. This isn't a perfect basis/growth split (that distinction
  // belongs to the per-account basis/growth note shown elsewhere), just a
  // sane upper bound on what this sentence claims came from basis.
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
    `You had about ${formatCurrency(rothBasisCapacity)} of tax-free Roth basis and ${formatCurrency(brokerageZeroLtcgCapacity)} you could have drawn from brokerage at 0% federal tax this year.`,
    `${formatCurrency(rothZeroUsed)} came from Roth basis and ${formatCurrency(brokerageZeroUsed)} from brokerage.`,
  ];

  const leftovers: string[] = [];
  if (rothUnused > 0)
    leftovers.push(`${formatCurrency(rothUnused)} of Roth basis`);
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
