/** The per-account notes and labels the projection table's tooltips show. */
import { formatCurrency } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import {
  describeBracketTargetChoice,
  describeDiscretionaryCapacityMath,
} from "@/lib/pure/advice/report/bracket-target-narrative";
import { HSA_DRAW_TREATMENT } from "@/lib/pure/accounts/early-access";
import {
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
  isTaxFreeBucket,
  nonMedicalPenaltyRate,
  tradPreferenceEngineCategories,
} from "@/lib/config/account-types";
import { describeEligibility } from "@/lib/config/eligibility-labels";
import { formatDiscretionaryTierBreakdown } from "./utils";

/** One account's eligibility + tracked-basis tooltip note. The basis clause
 *  is rebuilt from `roth.basisRemaining + basisDrawn`, deflated like the
 *  rest of the line, not from the reason's nominal `basis`. */
export function buildEligibilityNote(
  ia: IndividualAccountYearBalance,
  year: { year: number },
  deflate: (v: number, yr: number) => number,
): { note?: string; noteLocked?: boolean } {
  const parts: string[] = [];
  const reason = ia.draw?.reason;
  // A Roth IRA's basis reason. `no_basis` counts too: such an account is
  // locked unless its balance is under half a cent.
  const isBasisRemainingReason =
    ia.roth?.basisRemaining != null &&
    !ia.draw?.eligibilityLocked &&
    (reason?.kind === "basis_remaining" || reason?.kind === "no_basis");
  // Age 59½ reached (IRA or employer plan): Roth growth is tax-free. The
  // Rule of 55 lifts the penalty, never the tax, so it doesn't count.
  const isAgeQualified =
    reason?.kind === "age_reached" && reason.gate === "age_59_half";
  const basisDrawn = ia.roth?.basisDrawn ?? 0;
  const totalWithdrawn = ia.draw?.withdrawal ?? 0;
  // Basis-first ordering draws basis before growth. Under the
  // penalty-hard-exclusion model, growth this account hasn't earned
  // penalty-free access to should never be drawn at all by default —
  // this is only nonzero when the household has explicitly opted out of that
  // exclusion. Surfaced explicitly, and NEVER worded as plain "Eligible",
  // so it's never read as a free lunch: growth drawn while not yet
  // age-59½-qualified is flagged taxable and penalty-exposed.
  const growthDrawn = Math.max(0, roundToCents(totalWithdrawn - basisDrawn));
  if (isBasisRemainingReason) {
    const startBasis = (ia.roth?.basisRemaining ?? 0) + basisDrawn;
    const flag = ia.roth?.basisUncertain ? " (est.)" : "";
    const label = growthDrawn > 0.01 ? "Partially eligible" : "Eligible";
    parts.push(
      `${label} — ${formatCurrency(deflate(startBasis, year.year))} basis remaining, always penalty-free${flag}`,
    );
  } else if (reason) {
    parts.push(describeEligibility(reason));
  }
  if (basisDrawn > 0.01) {
    const drawn = formatCurrency(deflate(basisDrawn, year.year));
    const remaining = formatCurrency(
      deflate(ia.roth?.basisRemaining ?? 0, year.year),
    );
    const flag = ia.roth?.basisUncertain ? " (est.)" : "";
    if (growthDrawn > 0.01) {
      const growth = formatCurrency(deflate(growthDrawn, year.year));
      const taxNote = !isAgeQualified
        ? ", taxable + penalized (under 59½)"
        : "";
      parts.push(
        `basis ${drawn} + growth ${growth}${taxNote} drawn, ${remaining} basis left${flag}`,
      );
    } else {
      parts.push(`basis ${drawn} drawn, ${remaining} left${flag}`);
    }
  }
  if (parts.length === 0) return {};
  return { note: parts.join(" · "), noteLocked: !!ia.draw?.eligibilityLocked };
}

/**
 * "Why was this account used" tax-reasoning clause — the household asked
 * directly for this: eligibility/basis info alone doesn't say
 * WHY a discretionary (beyond-Traditional-bracket-target) dollar came from
 * this account instead of another. Reads `discretionaryTierBreakdown`
 * (`RouteResult.tierBreakdown`, withdrawal-routing/types.ts) filtered to this
 * account's source kind — see `formatDiscretionaryTierBreakdown`'s
 * docblock (utils.ts) for why this is read directly off routing's own
 * decision rather than re-derived.
 *
 * The breakdown is aggregated at the SOURCE-KIND level (roth/brokerage/
 * hsa), not per-account — a household with more than one account of the
 * same kind (e.g. both spouses' Roth 401k) would see the same combined
 * figures on each. `formatDiscretionaryTierBreakdown`'s own text is
 * explicitly "household-wide" framing for exactly this reason — never
 * implies this is a per-account cost breakdown this data can't actually
 * support, and deliberately avoids "free"/"0%" wording that would clash
 * with `buildEligibilityNote`'s own "taxable" note shown right above it on
 * the same line (Roth basis is genuinely
 * tax-free, but a Roth GROWTH tier entry can also legitimately show a
 * costRate of 0 at the household level, which is an ORDERING statement,
 * not a claim about this specific account's tax treatment).
 */
function buildRoutingReasonClause(
  ia: Pick<IndividualAccountYearBalance, "category" | "taxType">,
  yr: EngineDecumulationYear,
  deflate: (v: number, yr: number) => number,
  bracketOptimizerResult?: BracketOptimizerResult | null,
  includeCapacityNote?: boolean,
  onCapacityNoteUsed?: () => void,
): string | undefined {
  const catCfg = ACCOUNT_TYPE_CONFIG[ia.category];
  // Traditional portion of a split-capable account (401k/IRA/403b): this
  // is Phase 1 of bracket_filling, not the cost-ranked discretionary tier
  // below — a completely different "why" (a configured bracket TARGET,
  // not a cost comparison between sources). bracketTraditionalCap is the
  // resolved income cap (rothBracketTarget's marginal-rate threshold minus
  // taxable SS) the engine actually filled Traditional up to — see
  // withdrawal-routing/bracket-filling.ts's routeWithdrawalsBracketFilling.
  if (
    catCfg?.supportsRothSplit &&
    !isTaxFreeBucket(ia.taxType) &&
    yr.config.withdrawalRoutingMode === "bracket_filling" &&
    yr.bracketTraditionalCap != null
  ) {
    const targetPct = yr.config.rothBracketTarget;
    // "Why THIS bracket" — shares
    // describeBracketTargetChoice with the advisor report
    // (lib/pure/advice/report/bracket-target-narrative.ts) so the two can never
    // disagree; folds in the real numeric comparison from the bracket
    // optimizer when available, falls back to the qualitative-only
    // version otherwise.
    const targetClause =
      targetPct != null
        ? `Filled up to ${formatCurrency(deflate(yr.bracketTraditionalCap, yr.year))} of ordinary income this year (RMDs still apply on top when required). ${describeBracketTargetChoice(
            bracketOptimizerResult,
            targetPct,
            {
              bracketTraditionalCap: deflate(yr.bracketTraditionalCap, yr.year),
              taxableSS: deflate(yr.taxableSS, yr.year),
              // The GROWN per-year deduction (bracket-growth.ts), not the
              // plan-level engineSettings echo — pairing a
              // grown bracketTraditionalCap with an ungrown deduction in the
              // same sentence was internally inconsistent for any year
              // beyond the tax data's vintage.
              standardDeduction:
                yr.standardDeduction != null
                  ? deflate(yr.standardDeduction, yr.year)
                  : yr.standardDeduction,
            },
          )}`
        : `Filled to your configured bracket target — up to ${formatCurrency(deflate(yr.bracketTraditionalCap, yr.year))} of ordinary income`;
    // "Why this account over another" (cross-category order, e.g. 401k
    // before IRA) — your configured Traditional Account Order, restricted
    // to the Traditional-preference categories Phase 1 actually consults
    // (same restriction the order editor itself uses).
    const tradOrder = yr.config.withdrawalOrder.filter((c) =>
      tradPreferenceEngineCategories().includes(c),
    );
    const orderIdx = tradOrder.indexOf(ia.category);
    const orderClause =
      tradOrder.length > 1 && orderIdx >= 0
        ? ` · Order: ${tradOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" → ")} (this account: #${orderIdx + 1})`
        : "";
    return `${targetClause}${orderClause}`;
  }
  const hsaDraw = nonMedicalPenaltyRate(ia.category) !== null;
  const hsaNote = hsaDraw ? HSA_DRAW_TREATMENT : undefined; // ranked or not
  if (!yr.discretionaryTierBreakdown?.length) return hsaNote;
  let sourceKind: "roth" | "brokerage" | "hsa" | undefined;
  if (catCfg?.isOverflowTarget) sourceKind = "brokerage";
  else if (hsaDraw) sourceKind = "hsa";
  else if (catCfg?.supportsRothSplit && isTaxFreeBucket(ia.taxType))
    sourceKind = "roth";
  if (!sourceKind) return undefined;
  const relevant = yr.discretionaryTierBreakdown.filter(
    (t) => t.source === sourceKind,
  );
  if (relevant.length === 0) return hsaNote;
  const breakdownClause = formatDiscretionaryTierBreakdown(
    relevant.map((t) => ({ ...t, amount: deflate(t.amount, yr.year) })),
  );
  // "Why isn't brokerage draining before Roth" —
  // shares describeDiscretionaryCapacityMath with the advisor report so
  // the two can never disagree. Household-wide (not scoped to this
  // account's sourceKind, unlike breakdownClause above), so this uses the
  // FULL yr.discretionaryTierBreakdown, deflated the same way. Gated to
  // roth/brokerage rows only — this paragraph
  // discusses neither of an HSA row's dollars — AND to `includeCapacityNote`
  // (with 1 Roth + 2 brokerage accounts drawing the
  // same year, the identical household-wide paragraph showed up 3 times;
  // the caller sets this true for only the first qualifying account row).
  // lint-violation-ok: sourceKind is WithdrawalSourceKind, not an AccountCategory.
  const capacityClause =
    includeCapacityNote && (sourceKind === "roth" || sourceKind === "brokerage")
      ? describeDiscretionaryCapacityMath(
          yr.rothBasisCapacity != null && yr.brokerageZeroLtcgCapacity != null
            ? {
                rothBasisCapacity: deflate(yr.rothBasisCapacity, yr.year),
                brokerageZeroLtcgCapacity: deflate(
                  yr.brokerageZeroLtcgCapacity,
                  yr.year,
                ),
              }
            : undefined,
          yr.discretionaryTierBreakdown.map((t) => ({
            ...t,
            amount: deflate(t.amount, yr.year),
          })),
          yr.config.discretionaryWithdrawalOrder,
          yr.rmdOverrodeRouting,
        )
      : undefined;
  if (capacityClause) onCapacityNoteUsed?.();
  return [breakdownClause, capacityClause, hsaNote].filter(Boolean).join(" ");
}

/** Merges `buildEligibilityNote` (eligibility/basis) with
 *  `buildRoutingReasonClause` (tax reasoning) into the one note line an
 *  account's tooltip row shows — both answer "why," just different
 *  questions (can this money be touched vs. why did routing pick it). */
export function buildFullAccountNote(
  ia: IndividualAccountYearBalance,
  yr: EngineDecumulationYear,
  deflate: (v: number, yr: number) => number,
  bracketOptimizerResult?: BracketOptimizerResult | null,
  includeCapacityNote?: boolean,
  onCapacityNoteUsed?: () => void,
): { note?: string; noteLocked?: boolean } {
  const eligibility = buildEligibilityNote(ia, yr, deflate);
  const reason = buildRoutingReasonClause(
    ia,
    yr,
    deflate,
    bracketOptimizerResult,
    includeCapacityNote,
    onCapacityNoteUsed,
  );
  if (!reason) return eligibility;
  const note = eligibility.note ? `${eligibility.note} · ${reason}` : reason;
  return { note, noteLocked: eligibility.noteLocked };
}

/** Owner-prefixed account label for tooltip lines — omits the "Owner — "
 *  prefix when the account's own name already starts with the owner's
 *  name (many real account names, e.g. "Sam IRA (Vanguard)", already
 *  include it — prefixing again produced a visibly duplicated name). */
export function ownerAccountLabel(ia: {
  name: string;
  ownerName?: string;
}): string {
  if (!ia.ownerName) return ia.name;
  if (ia.name.toLowerCase().startsWith(ia.ownerName.toLowerCase())) {
    return ia.name;
  }
  return `${ia.ownerName} — ${ia.name}`;
}
