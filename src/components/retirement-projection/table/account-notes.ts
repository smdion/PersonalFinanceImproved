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
import { formatDiscretionaryTierBreakdown } from "../projection-display";

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
  // Basis-first ordering draws basis before growth. Growth without penalty-free access is
  // drawn only if the household opted out of the penalty exclusion; it's surfaced, never
  // worded "Eligible", and flagged taxable and penalty-exposed before age 59½.
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
 * "Why was this account used" clause, read off routing's own `discretionaryTierBreakdown` for this
 * account's source kind. That breakdown is household-wide (per kind, not per account), so the
 * text says so and avoids "free"/"0%" wording beside the eligibility note's "taxable".
 */
function buildRoutingReasonClause(
  ia: Pick<IndividualAccountYearBalance, "category" | "taxType">,
  yearRow: EngineDecumulationYear,
  deflate: (v: number, year: number) => number,
  bracketOptimizerResult?: BracketOptimizerResult | null,
  includeCapacityNote?: boolean,
  onCapacityNoteUsed?: () => void,
): string | undefined {
  const catCfg = ACCOUNT_TYPE_CONFIG[ia.category];
  // Traditional portion of a split-capable account: bracket_filling's Phase 1, filled to a
  // configured bracket target, not the cost-ranked tier below. bracketTraditionalCap is that
  // resolved income cap (see routeWithdrawalsBracketFilling).
  if (
    catCfg?.supportsRothSplit &&
    !isTaxFreeBucket(ia.taxType) &&
    yearRow.config.withdrawalRoutingMode === "bracket_filling" &&
    yearRow.bracketTraditionalCap != null
  ) {
    const targetPercent = yearRow.config.rothBracketTarget;
    // "Why THIS bracket": shares describeBracketTargetChoice with the advisor
    // report so they agree; uses the bracket optimizer's numeric comparison when
    // available, else the qualitative version.
    const targetClause =
      targetPercent != null
        ? `Filled up to ${formatCurrency(deflate(yearRow.bracketTraditionalCap, yearRow.year))} of ordinary income this year (RMDs still apply on top when required). ${describeBracketTargetChoice(
            bracketOptimizerResult,
            targetPercent,
            {
              bracketTraditionalCap: deflate(
                yearRow.bracketTraditionalCap,
                yearRow.year,
              ),
              taxableSS: deflate(yearRow.taxableSS, yearRow.year),
              // The grown per-year deduction (bracket-growth.ts), matching the
              // grown bracketTraditionalCap, not the plan-level engineSettings echo.
              standardDeduction:
                yearRow.standardDeduction != null
                  ? deflate(yearRow.standardDeduction, yearRow.year)
                  : yearRow.standardDeduction,
            },
          )}`
        : `Filled to your configured bracket target — up to ${formatCurrency(deflate(yearRow.bracketTraditionalCap, yearRow.year))} of ordinary income`;
    // "Why this account over another": the configured Traditional Account Order,
    // restricted to the Traditional-preference categories Phase 1 consults (as
    // the order editor does).
    const tradOrder = yearRow.config.withdrawalOrder.filter((c) =>
      tradPreferenceEngineCategories().includes(c),
    );
    const orderIndex = tradOrder.indexOf(ia.category);
    const orderClause =
      tradOrder.length > 1 && orderIndex >= 0
        ? ` · Order: ${tradOrder.map((c) => getAccountTypeConfig(c).displayLabel).join(" → ")} (this account: #${orderIndex + 1})`
        : "";
    return `${targetClause}${orderClause}`;
  }
  const hsaDraw = nonMedicalPenaltyRate(ia.category) !== null;
  const hsaNote = hsaDraw ? HSA_DRAW_TREATMENT : undefined; // ranked or not
  if (!yearRow.discretionaryTierBreakdown?.length) return hsaNote;
  let sourceKind: "roth" | "brokerage" | "hsa" | undefined;
  if (catCfg?.isOverflowTarget) sourceKind = "brokerage";
  else if (hsaDraw) sourceKind = "hsa";
  else if (catCfg?.supportsRothSplit && isTaxFreeBucket(ia.taxType))
    sourceKind = "roth";
  if (!sourceKind) return undefined;
  const relevant = yearRow.discretionaryTierBreakdown.filter(
    (t) => t.source === sourceKind,
  );
  if (relevant.length === 0) return hsaNote;
  const breakdownClause = formatDiscretionaryTierBreakdown(
    relevant.map((t) => ({ ...t, amount: deflate(t.amount, yearRow.year) })),
  );
  // "Why isn't brokerage draining before Roth" (shared with the advisor report): household-wide,
  // on roth/brokerage rows only, once per year (`includeCapacityNote` marks the first such row).
  // lint-violation-ok: sourceKind is WithdrawalSourceKind, not an AccountCategory.
  const capacityClause =
    includeCapacityNote && (sourceKind === "roth" || sourceKind === "brokerage")
      ? describeDiscretionaryCapacityMath(
          yearRow.rothBasisCapacity != null &&
            yearRow.brokerageZeroLtcgCapacity != null
            ? {
                rothBasisCapacity: deflate(
                  yearRow.rothBasisCapacity,
                  yearRow.year,
                ),
                brokerageZeroLtcgCapacity: deflate(
                  yearRow.brokerageZeroLtcgCapacity,
                  yearRow.year,
                ),
              }
            : undefined,
          yearRow.discretionaryTierBreakdown.map((t) => ({
            ...t,
            amount: deflate(t.amount, yearRow.year),
          })),
          yearRow.config.discretionaryWithdrawalOrder,
          yearRow.rmdOverrodeRouting,
        )
      : undefined;
  if (capacityClause) onCapacityNoteUsed?.();
  return [breakdownClause, capacityClause, hsaNote].filter(Boolean).join(" ");
}

/** Merges `buildEligibilityNote` (can this money be touched) with
 *  `buildRoutingReasonClause` (why routing picked it) into the account's one
 *  tooltip note line. */
export function buildFullAccountNote(
  ia: IndividualAccountYearBalance,
  yearRow: EngineDecumulationYear,
  deflate: (v: number, year: number) => number,
  bracketOptimizerResult?: BracketOptimizerResult | null,
  includeCapacityNote?: boolean,
  onCapacityNoteUsed?: () => void,
): { note?: string; noteLocked?: boolean } {
  const eligibility = buildEligibilityNote(ia, yearRow, deflate);
  const reason = buildRoutingReasonClause(
    ia,
    yearRow,
    deflate,
    bracketOptimizerResult,
    includeCapacityNote,
    onCapacityNoteUsed,
  );
  if (!reason) return eligibility;
  const note = eligibility.note ? `${eligibility.note} · ${reason}` : reason;
  return { note, noteLocked: eligibility.noteLocked };
}

/** Owner-prefixed account label for tooltip lines; omits the "Owner — "
 *  prefix when the account name already starts with the owner's name. */
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
