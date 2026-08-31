/** Renders a single decumulation-phase table row with withdrawal breakdowns, tax costs, balance columns, and MC cell. */
import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide, roundToCents } from "@/lib/utils/math";
import type {
  AccountCategory,
  EngineDecumulationYear,
  DecumulationSlot,
  IndividualAccountYearBalance,
} from "@/lib/calculators/types";
import {
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
  isTaxFreeBucket,
  isIraCategory,
  isHsaCategory,
  tradPreferenceEngineCategories,
} from "@/lib/config/account-types";
import type { TipColor, TooltipLineItem } from "./types";
import {
  catDisplayLabel,
  bucketSlotMap,
  itemTaxType,
  colKeyParts,
  colBalance,
  colWithdrawal,
  colEngineTaxType,
  slotBucketWithdrawal,
  iaBelongsToBucket,
  percentOf,
  lumpSumsForBucket,
  lumpSumsForCategory,
  lumpSumTotal,
  buildStrategyEventStyle,
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
} from "./utils";
import type { ProjectionState } from "./projection-table-types";
import {
  renderMcCell,
  type RenderMcCellOptions,
} from "./projection-table-mc-cell";

/**
 * Builds the merged eligibility + tracked-basis note for one account's
 * tooltip line. Bug fix (found live, real household data): the engine's
 * `eligibilityReason` string bakes its "$X basis remaining" figure as plain
 * NOMINAL dollars (it's built deep in withdrawal-eligibility.ts, which has
 * no access to the page's real/nominal dollar-mode toggle) — but the
 * rothBasisDrawn/rothBasisRemaining figures merged onto the same line ARE
 * deflated. In real-dollar view mode the two halves of one line disagreed
 * by exactly the household's cumulative inflation factor (confirmed:
 * ratio was identical, ~1.99, across both the reason string's figure and
 * the year's own withdrawal/growth figures). Reconstructs the basis-
 * remaining clause from `rothBasisRemaining + rothBasisDrawn` (this year's
 * start-of-year basis, tautologically consistent with the drawn/left
 * figures since both add up from the same already-deflated fields) instead
 * of reusing the engine string's embedded dollar figure — so every number
 * on the line moves together with the SAME toggle, whichever way it's set.
 * Non-basis reason text (Rule of 55 / age-59½ / locked wording, none of
 * which embeds a dollar figure) is untouched.
 */
function buildEligibilityNote(
  ia: IndividualAccountYearBalance,
  year: EngineDecumulationYear,
  deflate: (v: number, yr: number) => number,
): { note?: string; noteLocked?: boolean } {
  const parts: string[] = [];
  const isBasisRemainingReason =
    ia.rothBasisRemaining != null &&
    !ia.eligibilityLocked &&
    (ia.eligibilityReason?.includes("basis remaining") ?? false);
  // Age-59½ qualification (tax-free growth) is a DIFFERENT test than the
  // Rule-of-55 wording above — Rule of 55 exempts the 10% penalty, never
  // taxability (splitRothWithdrawalForTax only ever checks age 59½). Both
  // the IRA (basis_first) and 401k/403b (pro_rata) branches of
  // withdrawal-eligibility.ts emit this exact string when age-qualified,
  // so checking for it (rather than reusing isBasisRemainingReason, which
  // is IRA-reason-text-specific) correctly flags non-qualified growth as
  // taxable for BOTH account types.
  const isAgeQualified =
    ia.eligibilityReason?.includes("age 59½ or older") ?? false;
  const basisDrawn = ia.rothBasisDrawn ?? 0;
  const totalWithdrawn = ia.withdrawal ?? 0;
  // Basis-first ordering draws basis before growth. Under the v0.7.8
  // penalty-hard-exclusion model growth this account hasn't earned
  // penalty-free access to should never be drawn at all by default
  // (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md) — this is only
  // nonzero when the household has explicitly opted out of that
  // exclusion. Surfaced explicitly, and NEVER worded as plain "Eligible",
  // so it's never read as a free lunch: growth drawn while not yet
  // age-59½-qualified is flagged taxable (v0.7.8 Roth-tax-basis
  // follow-up) and penalty-exposed (FEATURE-ROADMAP.md R39).
  const growthDrawn = Math.max(0, roundToCents(totalWithdrawn - basisDrawn));
  if (isBasisRemainingReason) {
    const startBasis = (ia.rothBasisRemaining ?? 0) + basisDrawn;
    const flag = ia.rothBasisUncertain ? " (est.)" : "";
    const label = growthDrawn > 0.01 ? "Partially eligible" : "Eligible";
    parts.push(
      `${label} — ${formatCurrency(deflate(startBasis, year.year))} basis remaining, always penalty-free${flag}`,
    );
  } else if (ia.eligibilityReason) {
    parts.push(ia.eligibilityReason);
  }
  if (basisDrawn > 0.01) {
    const drawn = formatCurrency(deflate(basisDrawn, year.year));
    const remaining = formatCurrency(
      deflate(ia.rothBasisRemaining ?? 0, year.year),
    );
    const flag = ia.rothBasisUncertain ? " (est.)" : "";
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
  return { note: parts.join(" · "), noteLocked: !!ia.eligibilityLocked };
}

/**
 * "Why was this account used" tax-reasoning clause — the household asked
 * directly for this (2026-08-31): eligibility/basis info alone doesn't say
 * WHY a discretionary (beyond-Traditional-bracket-target) dollar came from
 * this account instead of another. Reads `discretionaryTierBreakdown`
 * (`RouteResult.tierBreakdown`, withdrawal-routing.ts) filtered to this
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
 * the same line (found live, 2026-08-31 — Roth basis is genuinely
 * tax-free, but a Roth GROWTH tier entry can also legitimately show a
 * costRate of 0 at the household level, which is an ORDERING statement,
 * not a claim about this specific account's tax treatment).
 */
function buildRoutingReasonClause(
  ia: Pick<IndividualAccountYearBalance, "category" | "taxType" | "withdrawal">,
  yr: EngineDecumulationYear,
  deflate: (v: number, yr: number) => number,
): string | undefined {
  const catCfg = ACCOUNT_TYPE_CONFIG[ia.category];
  // Traditional portion of a split-capable account (401k/IRA/403b): this
  // is Phase 1 of bracket_filling, not the cost-ranked discretionary tier
  // below — a completely different "why" (a configured bracket TARGET,
  // not a cost comparison between sources). bracketTraditionalCap is the
  // resolved income cap (rothBracketTarget's marginal-rate threshold minus
  // taxable SS) the engine actually filled Traditional up to — see
  // withdrawal-routing.ts's routeWithdrawalsBracketFilling.
  if (
    catCfg?.supportsRothSplit &&
    !isTaxFreeBucket(ia.taxType) &&
    yr.config.withdrawalRoutingMode === "bracket_filling" &&
    yr.bracketTraditionalCap != null
  ) {
    const targetPct = yr.config.rothBracketTarget;
    const targetClause =
      targetPct != null
        ? `Filled to your ${formatPercent(targetPct, 0)} bracket target — up to ${formatCurrency(deflate(yr.bracketTraditionalCap, yr.year))} of ordinary income (RMDs still apply on top when required)`
        : `Filled to your configured bracket target — up to ${formatCurrency(deflate(yr.bracketTraditionalCap, yr.year))} of ordinary income`;
    // "Why this account over another" (cross-category order, e.g. 401k
    // before IRA) — your configured Traditional Account Order, restricted
    // to the Traditional-preference categories Phase 1 actually consults
    // (same restriction the order editor itself uses — decumulation-
    // config.tsx's R51 Gap A note).
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
  if (!yr.discretionaryTierBreakdown?.length) return undefined;
  let sourceKind: "roth" | "brokerage" | "hsa" | undefined;
  if (catCfg?.isOverflowTarget) sourceKind = "brokerage";
  else if (isHsaCategory(ia.category)) sourceKind = "hsa";
  else if (catCfg?.supportsRothSplit && isTaxFreeBucket(ia.taxType))
    sourceKind = "roth";
  if (!sourceKind) return undefined;
  const relevant = yr.discretionaryTierBreakdown.filter(
    (t) => t.source === sourceKind,
  );
  if (relevant.length === 0) return undefined;
  return formatDiscretionaryTierBreakdown(
    relevant.map((t) => ({ ...t, amount: deflate(t.amount, yr.year) })),
  );
}

/** Merges `buildEligibilityNote` (eligibility/basis) with
 *  `buildRoutingReasonClause` (tax reasoning) into the one note line an
 *  account's tooltip row shows — both answer "why," just different
 *  questions (can this money be touched vs. why did routing pick it). */
function buildFullAccountNote(
  ia: IndividualAccountYearBalance,
  yr: EngineDecumulationYear,
  deflate: (v: number, yr: number) => number,
): { note?: string; noteLocked?: boolean } {
  const eligibility = buildEligibilityNote(ia, yr, deflate);
  const reason = buildRoutingReasonClause(ia, yr, deflate);
  if (!reason) return eligibility;
  const note = eligibility.note ? `${eligibility.note} · ${reason}` : reason;
  return { note, noteLocked: eligibility.noteLocked };
}

/** Owner-prefixed account label for tooltip lines — omits the "Owner — "
 *  prefix when the account's own name already starts with the owner's
 *  name (many real account names, e.g. "Joanna IRA (Vanguard)", already
 *  include it — prefixing again produced a visibly duplicated name). */
function ownerAccountLabel(ia: { name: string; ownerName?: string }): string {
  if (!ia.ownerName) return ia.name;
  if (ia.name.toLowerCase().startsWith(ia.ownerName.toLowerCase())) {
    return ia.name;
  }
  return `${ia.ownerName} — ${ia.name}`;
}

export type DecumulationRowProps = {
  yr: EngineDecumulationYear;
  state: ProjectionState;
  parentCategoryFilter?: string;
  isPhaseTransition: boolean;
  hasOverride: boolean;
  decumOverrideNotes?: string;
  salaryOverrideNotes?: string | null;
  budgetOverrideNotes?: string | null;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  people?: { id: number; name: string; birthYear: number }[];
  mcCellOpts: RenderMcCellOptions;
};

export function DecumulationRow({
  yr: dyr,
  state,
  parentCategoryFilter: _parentCategoryFilter,
  isPhaseTransition,
  hasOverride,
  decumOverrideNotes,
  salaryOverrideNotes: _salaryOverrideNotes,
  budgetOverrideNotes,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
  people,
  mcCellOpts,
}: DecumulationRowProps) {
  const {
    decumOverrides: _decumOverrides,
    balanceView,
    contribView,
    diagMode,
    personFilter,
    isPersonFiltered,
    visibleColumns,
    deflate,
    getPersonYearTotals,
    baseYear: _baseYear,
    displayAge,
    renderTooltip,
    enginePeople,
    engineSettings,
    withdrawalRoutingMode: _withdrawalRoutingMode,
    budgetProfileSummaries,
    result,
  } = state;
  if (!result) return null;

  // Alias for code extracted from inline — uses `yr` throughout
  const yr = dyr;

  const dSlotMap = new Map<AccountCategory, DecumulationSlot>(
    dyr.slots.map((s) => [s.category, s]),
  );
  const dpt = getPersonYearTotals(yr);
  const yearLumpSums = dyr.config.lumpSums;
  const totalLumpSum = lumpSumTotal(yearLumpSums);

  // Detect milestone years for row highlighting
  const ssAge = engineSettings?.ssStartAge;
  const isSsStartRow = ssAge != null && yr.age === ssAge && dyr.ssIncome > 0;
  const firstRmdAge = result.projectionByYear.find(
    (y) => y.phase === "decumulation" && y.rmdAmount > 0,
  )?.age;
  const isRmdStartRow =
    firstRmdAge != null && yr.age === firstRmdAge && dyr.rmdAmount > 0;

  return (
    <tr
      key={yr.year}
      className={`border-b border-subtle hover:bg-surface-elevated/60 transition-colors ${
        isPhaseTransition
          ? "bg-blue-50 font-medium"
          : hasOverride
            ? "bg-amber-50"
            : yr.endBalance < 1
              ? "bg-red-50"
              : isSsStartRow
                ? "bg-teal-50"
                : isRmdStartRow
                  ? "bg-amber-50"
                  : ""
      }`}
    >
      <td className="py-1.5 pr-2">{yr.year}</td>
      <Tooltip
        content={(() => {
          const pp = people ?? enginePeople;
          if (!pp || pp.length < 2) return undefined;
          return renderTooltip({
            kind: "info",
            lines: pp.map((p) => ({
              text: `${p.name}: ${yr.year - p.birthYear}`,
              style: "header" as const,
            })),
          });
        })()}
        side="top"
      >
        <td className="py-1.5 px-2">{displayAge(yr.year) ?? yr.age}</td>
      </Tooltip>
      <td className="py-1.5 px-2">
        <span className="text-amber-600 text-caption font-medium">DRAW</span>
      </td>
      <Tooltip content="No salary income during retirement" side="top">
        <td className="text-right py-1.5 px-2 text-faint">---</td>
      </Tooltip>
      <Tooltip content="No contribution rate during retirement" side="top">
        <td className="text-right py-1.5 px-2 text-faint">---</td>
      </Tooltip>
      {contribView === "account"
        ? getAllCategories()
            .filter((c) => visibleColumns.contribCats.has(c))
            .map((cat) => {
              const dSlot = dSlotMap.get(cat);
              const wd = dSlot?.withdrawal ?? 0;
              // Get growth from individualAccountBalances for this category
              const iabs = yr.individualAccountBalances ?? [];
              const catAccts = dpt
                ? iabs.filter(
                    (ia) =>
                      ia.ownerPersonId === personFilter && ia.category === cat,
                  )
                : iabs.filter((ia) => ia.category === cat);
              const catGrowth = catAccts.reduce((s, ia) => s + ia.growth, 0);
              const catBal = catAccts.reduce((s, ia) => s + ia.balance, 0);
              return (
                <Tooltip
                  key={cat}
                  content={(() => {
                    const dSlot = dSlotMap.get(cat);
                    const items: TooltipLineItem[] = [];
                    const catCfg = getAccountTypeConfig(cat);
                    // Per-account note (v0.7.8 tooltip-readability pass,
                    // DESIGN-DECISION-v0.7.8-tooltip-readability.md Option
                    // C): merges this account's withdrawal-ordering
                    // eligibility verdict and tracked Roth basis draw-down
                    // into ONE dim line under its amount, instead of
                    // repeating the account name on separate lines for each
                    // fact. See buildEligibilityNote's docblock for why the
                    // basis-remaining figure is reconstructed rather than
                    // reusing eligibilityReason's embedded dollar amount.
                    const buildNote = (ia: (typeof catAccts)[number]) =>
                      buildFullAccountNote(ia, yr, deflate);
                    if (wd > 0) {
                      // Per-account breakdown ("no magic money"): when a
                      // category holds more than one tracked account (e.g.
                      // both spouses' 401ks, or a Trad + Roth sub-account),
                      // show exactly which account(s) were drawn from
                      // rather than one aggregated Trad/Roth line per
                      // category. Falls back to the old aggregate when no
                      // individual-account data exists for this category.
                      const withdrawingAccts = catAccts
                        .filter((ia) => (ia.withdrawal ?? 0) > 0.01)
                        .sort((a, b) => {
                          const taxDiff =
                            (isTaxFreeBucket(a.taxType) ? 1 : 0) -
                            (isTaxFreeBucket(b.taxType) ? 1 : 0);
                          if (taxDiff !== 0) return taxDiff;
                          return (a.ownerName ?? a.name).localeCompare(
                            b.ownerName ?? b.name,
                          );
                        });
                      if (withdrawingAccts.length > 0) {
                        const multiAcct = withdrawingAccts.length > 1;
                        for (const ia of withdrawingAccts) {
                          items.push({
                            label: multiAcct
                              ? ownerAccountLabel(ia)
                              : catCfg.displayLabel,
                            amount: deflate(ia.withdrawal!, yr.year),
                            prefix: "-",
                            taxType: itemTaxType(ia.category, ia.taxType),
                            color: "red",
                            ...buildNote(ia),
                          });
                        }
                      } else if (
                        catCfg.supportsRothSplit &&
                        dSlot &&
                        (dSlot.traditionalWithdrawal > 0 ||
                          dSlot.rothWithdrawal > 0)
                      ) {
                        if (dSlot.traditionalWithdrawal > 0)
                          items.push({
                            label: catCfg.displayLabel,
                            amount: deflate(
                              dSlot.traditionalWithdrawal,
                              yr.year,
                            ),
                            prefix: "-",
                            taxType: "traditional",
                            color: "red",
                          });
                        if (dSlot.rothWithdrawal > 0)
                          items.push({
                            label: catCfg.displayLabel,
                            amount: deflate(dSlot.rothWithdrawal, yr.year),
                            prefix: "-",
                            taxType: "roth",
                            color: "red",
                          });
                      }
                    }
                    // Add lump sum items for this category
                    const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                    for (const ls of catLumps) {
                      items.push({
                        label: ls.label ?? "Lump sum",
                        amount: deflate(ls.amount, yr.year),
                        prefix: "+",
                        color: "emerald",
                      });
                    }
                    // R46: RMD-forced excess (beyond stated spending need)
                    // — real money, forced out of Traditional by the RMD
                    // floor regardless of what the strategy needed,
                    // previously invisible anywhere in the UI. What
                    // happened to it depends on the household's
                    // rmdExcessHandling setting: "reinvest" (default)
                    // actually credits this account (overflow target,
                    // always brokerage), so shown as a real "+" line there;
                    // "spend" never credits any account (the household
                    // consumed it), so shown as an informational note
                    // instead, not implied to have landed in this balance.
                    const rmdExcess = yr.rmdExcessAmount ?? 0;
                    const rmdMode = engineSettings?.rmdExcessHandling;
                    if (
                      rmdExcess > 0.01 &&
                      ACCOUNT_TYPE_CONFIG[cat].isOverflowTarget
                    ) {
                      if (rmdMode === "spend") {
                        items.push({
                          label: "RMD excess spent (not reinvested)",
                          amount: deflate(rmdExcess, yr.year),
                          color: "gray",
                        });
                      } else {
                        items.push({
                          label: "RMD excess reinvested",
                          amount: deflate(rmdExcess, yr.year),
                          prefix: "+",
                          color: "amber",
                        });
                      }
                    }
                    // R46: Qualified Charitable Distribution — money sent
                    // directly from this account to charity, satisfying
                    // part of the RMD without counting as taxable income.
                    // Real money leaving the account (a "-" like any other
                    // withdrawal), but was completely invisible previously
                    // — QCD bypasses withdrawal routing entirely (it's
                    // deducted before routing even runs), so there was no
                    // slot/withdrawal line item anywhere that would have
                    // shown it. Only ever deducted from "ira" (QCDs are
                    // IRA-only under current law).
                    const qcdAmount = yr.qcdAmount ?? 0;
                    if (qcdAmount > 0.01 && isIraCategory(cat)) {
                      items.push({
                        label: "QCD to charity (excluded from taxable income)",
                        amount: deflate(qcdAmount, yr.year),
                        prefix: "-",
                        color: "violet",
                      });
                    }
                    const catLumpTotal = lumpSumTotal(catLumps);
                    // "Why was this account used" — which source kind(s)
                    // this category's withdrawal drew through in the
                    // cost-ranked discretionary tier (beyond Traditional's
                    // bracket-fill target). A category can match more than
                    // one kind (e.g. a 401k/IRA with both a Roth sub-
                    // balance AND acting as the overflow/brokerage target
                    // is not possible today, but HSA and brokerage never
                    // overlap with "roth") — filtering by source keeps this
                    // scoped to what's actually relevant to THIS account,
                    // not the whole household's breakdown.
                    const catSourceKinds = new Set<
                      "roth" | "brokerage" | "hsa"
                    >();
                    if (catCfg.isOverflowTarget)
                      catSourceKinds.add("brokerage");
                    if (isHsaCategory(cat)) catSourceKinds.add("hsa");
                    if (
                      catCfg.supportsRothSplit &&
                      (dSlot?.rothWithdrawal ?? 0) > 0.01
                    )
                      catSourceKinds.add("roth");
                    const catTierBreakdown =
                      yr.discretionaryTierBreakdown?.filter((t) =>
                        catSourceKinds.has(t.source),
                      );
                    return renderTooltip({
                      kind: "money",
                      header: `${catDisplayLabel[cat] ?? cat}${catLumpTotal > 0 || rmdExcess > 0.01 || qcdAmount > 0.01 ? " Activity" : " Withdrawals"}`,
                      items: items.length > 0 ? items : undefined,
                      withdrawals:
                        wd > 0 && items.length === 0
                          ? {
                              amount: deflate(wd, yr.year),
                            }
                          : undefined,
                      growth:
                        Math.abs(catGrowth) > 1
                          ? {
                              amount: deflate(catGrowth, yr.year),
                            }
                          : undefined,
                      routingNote: formatDiscretionaryTierBreakdown(
                        catTierBreakdown?.map((t) => ({
                          ...t,
                          amount: deflate(t.amount, yr.year),
                        })),
                      ),
                      balance: deflate(catBal, yr.year),
                    });
                  })()}
                  side="top"
                  maxWidth={420}
                >
                  <td
                    className={`text-right py-1.5 px-2 ${(() => {
                      const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                      const catLumpTotal = lumpSumTotal(catLumps);
                      if (catLumpTotal > 0 && catLumpTotal > wd)
                        return "text-green-600";
                      return accountTextColor(cat);
                    })()}`}
                  >
                    {(() => {
                      const catLumps = lumpSumsForCategory(yearLumpSums, cat);
                      const catLumpTotal = lumpSumTotal(catLumps);
                      if (catLumpTotal > 0 && wd > 0) {
                        const net = catLumpTotal - wd;
                        return net >= 0
                          ? `+${formatCurrency(deflate(net, yr.year))}`
                          : `-${formatCurrency(deflate(Math.abs(net), yr.year))}`;
                      }
                      if (catLumpTotal > 0)
                        return `+${formatCurrency(deflate(catLumpTotal, yr.year))}`;
                      if (wd > 0)
                        return `-${formatCurrency(deflate(wd, yr.year))}`;
                      return "---";
                    })()}
                  </td>
                </Tooltip>
              );
            })
        : /* Withdrawal columns by tax type */
          (["preTax", "taxFree", "hsa", "afterTax"] as const)
            .filter((t) => visibleColumns.contribTaxTypes.has(t))
            .map((bucket) => {
              let bucketWd = 0;
              const parts: {
                cat: string;
                wd: number;
              }[] = [];
              for (const slot of dyr.slots) {
                const wd = slotBucketWithdrawal(slot, bucket);
                if (wd > 0) {
                  parts.push({
                    cat: slot.category,
                    wd,
                  });
                  bucketWd += wd;
                }
              }
              return (
                <Tooltip
                  key={bucket}
                  content={
                    parts.length > 0
                      ? (() => {
                          const taxPrefCat = categoriesWithTaxPreference()[0]!;
                          const wdTaxType = bucketSlotMap[bucket]?.taxField
                            ? itemTaxType(
                                taxPrefCat,
                                bucketSlotMap[bucket]!.taxField,
                              )
                            : undefined;
                          const bucketLumps = lumpSumsForBucket(
                            yearLumpSums,
                            bucket,
                          );
                          const allItems = [
                            ...parts.map((p) => ({
                              label: catDisplayLabel[p.cat] ?? p.cat,
                              amount: deflate(p.wd, yr.year),
                              prefix: "-" as const,
                              taxType: itemTaxType(p.cat, wdTaxType),
                              color: "red" as TipColor,
                            })),
                            ...bucketLumps.map((ls) => ({
                              label: ls.label ?? "Lump sum",
                              amount: deflate(ls.amount, yr.year),
                              prefix: "+" as const,
                              color: "emerald" as TipColor,
                            })),
                          ];
                          const bucketLumpTotal = lumpSumTotal(bucketLumps);
                          return renderTooltip({
                            kind: "money",
                            header: `${taxTypeLabel(bucket)}${bucketLumpTotal > 0 ? " Activity" : " Withdrawals"}`,
                            items: allItems,
                            total:
                              allItems.length > 1
                                ? {
                                    label: "Net",
                                    amount: deflate(
                                      bucketLumpTotal - bucketWd,
                                      yr.year,
                                    ),
                                    prefix:
                                      bucketLumpTotal >= bucketWd ? "+" : "-",
                                  }
                                : undefined,
                          });
                        })()
                      : (() => {
                          const bucketLumps = lumpSumsForBucket(
                            yearLumpSums,
                            bucket,
                          );
                          if (bucketLumps.length === 0) return undefined;
                          return renderTooltip({
                            kind: "money",
                            header: `${taxTypeLabel(bucket)} Lump Sum`,
                            items: bucketLumps.map((ls) => ({
                              label: ls.label ?? "Lump sum",
                              amount: deflate(ls.amount, yr.year),
                              prefix: "+" as const,
                              color: "emerald" as TipColor,
                            })),
                          });
                        })()
                  }
                  side="top"
                >
                  <td
                    className={`text-right py-1.5 px-2 ${(() => {
                      const bucketLumps = lumpSumsForBucket(
                        yearLumpSums,
                        bucket,
                      );
                      const bucketLumpTotal = lumpSumTotal(bucketLumps);
                      if (bucketLumpTotal > 0 && bucketLumpTotal > bucketWd)
                        return "text-green-600";
                      return taxTypeTextColor(bucket);
                    })()}`}
                  >
                    {(() => {
                      const bucketLumps = lumpSumsForBucket(
                        yearLumpSums,
                        bucket,
                      );
                      const bucketLumpTotal = lumpSumTotal(bucketLumps);
                      if (bucketLumpTotal > 0 && bucketWd > 0) {
                        const net = bucketLumpTotal - bucketWd;
                        return net >= 0
                          ? `+${formatCurrency(deflate(net, yr.year))}`
                          : `-${formatCurrency(deflate(Math.abs(net), yr.year))}`;
                      }
                      if (bucketLumpTotal > 0)
                        return `+${formatCurrency(deflate(bucketLumpTotal, yr.year))}`;
                      if (bucketWd > 0)
                        return `-${formatCurrency(deflate(bucketWd, yr.year))}`;
                      return "---";
                    })()}
                  </td>
                </Tooltip>
              );
            })}
      <Tooltip
        content={(() => {
          const iabs = yr.individualAccountBalances ?? [];
          const filteredIabs = dpt
            ? iabs.filter((ia) => ia.ownerPersonId === personFilter)
            : iabs;
          const items: TooltipLineItem[] = [];
          if (dyr.totalWithdrawal > 0) {
            // Per-account breakdown (v0.7.8 tracked-basis follow-up — "no
            // magic money"): every account that was actually drawn from
            // this year gets its own line, so the total isn't just an
            // aggregate Trad/Roth split — the user can see exactly which
            // account(s), whose, funded it. Ordered by category (accum
            // order), then traditional before roth, then owner name.
            const catOrder = new Map(getAllCategories().map((c, i) => [c, i]));
            const withdrawingAccts = filteredIabs
              .filter((ia) => (ia.withdrawal ?? 0) > 0.01)
              .sort((a, b) => {
                const catDiff =
                  (catOrder.get(a.category) ?? 0) -
                  (catOrder.get(b.category) ?? 0);
                if (catDiff !== 0) return catDiff;
                const taxDiff =
                  (isTaxFreeBucket(a.taxType) ? 1 : 0) -
                  (isTaxFreeBucket(b.taxType) ? 1 : 0);
                if (taxDiff !== 0) return taxDiff;
                return (a.ownerName ?? a.name).localeCompare(
                  b.ownerName ?? b.name,
                );
              });
            if (withdrawingAccts.length > 0) {
              for (const ia of withdrawingAccts) {
                // Merge this account's eligibility verdict + tracked Roth
                // basis draw-down onto its own line (v0.7.8
                // tooltip-readability pass) instead of a separate
                // household-wide text block — see `buildEligibilityNote`'s
                // docblock above (and the fix note there) for why the
                // basis-remaining dollar figure is reconstructed rather
                // than reused verbatim. Bounded by construction: only
                // accounts actually withdrawn from this year appear here,
                // so this can't regrow into the old "every account in the
                // household" wall of text.
                items.push({
                  label: ownerAccountLabel(ia),
                  amount: deflate(ia.withdrawal!, yr.year),
                  prefix: "-",
                  taxType: itemTaxType(ia.category, ia.taxType),
                  color: "red",
                  group: catDisplayLabel[ia.category] ?? ia.category,
                  ...buildFullAccountNote(ia, yr, deflate),
                });
              }
            } else {
              // Fallback for households without per-account tracking data
              // (e.g. simple-mode / no individual accounts modeled): the
              // old aggregate Trad/Roth + non-split-category breakdown.
              if (dyr.totalTraditionalWithdrawal > 0)
                items.push({
                  label: taxTypeLabel("preTax"),
                  amount: deflate(dyr.totalTraditionalWithdrawal, yr.year),
                  prefix: "-",
                  color: "blue",
                });
              if (dyr.totalRothWithdrawal > 0)
                items.push({
                  label: taxTypeLabel("taxFree"),
                  amount: deflate(dyr.totalRothWithdrawal, yr.year),
                  prefix: "-",
                  color: "violet",
                });
              for (const sbCat of getAllCategories().filter(
                (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
              )) {
                const sbWd = dSlotMap.get(sbCat)?.withdrawal ?? 0;
                if (sbWd > 0)
                  items.push({
                    label: getAccountTypeConfig(sbCat).displayLabel,
                    amount: deflate(sbWd, yr.year),
                    prefix: "-",
                    color:
                      sbCat ===
                      getAllCategories().find(
                        (c) => ACCOUNT_TYPE_CONFIG[c].isOverflowTarget,
                      )
                        ? "amber"
                        : "emerald",
                  });
              }
            }
          }
          // Add lump sum items
          for (const ls of yearLumpSums) {
            items.push({
              label: ls.label
                ? `${ls.label} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`
                : `Lump sum → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
              amount: deflate(ls.amount, yr.year),
              prefix: "+",
              color: "emerald",
            });
          }
          const totalGrowth = filteredIabs.reduce((s, ia) => s + ia.growth, 0);
          const decBudgetProfile =
            decumulationBudgetProfileId != null
              ? budgetProfileSummaries?.find(
                  (p) => p.id === decumulationBudgetProfileId,
                )
              : undefined;
          const budgetProfileName =
            decumulationExpenseOverride != null
              ? `Manual override${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
              : decBudgetProfile
                ? `${decBudgetProfile.name}${decumulationBudgetColumn != null && decBudgetProfile.columnLabels[decumulationBudgetColumn] ? ` (${decBudgetProfile.columnLabels[decumulationBudgetColumn]})` : ""}${dyr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                : undefined;
          // SS/RMD context for withdrawal tooltip
          const hasSs = dyr.ssIncome > 0;
          const hasRmd = dyr.rmdAmount > 0;
          const ssBreakdown = dyr.ssIncomeByPerson?.filter((e) => e.amount > 0);
          const ssDetail =
            ssBreakdown && ssBreakdown.length > 1
              ? ssBreakdown
                  .map(
                    (e) =>
                      `${e.personName}: ${formatCurrency(deflate(e.amount, yr.year))}`,
                  )
                  .join(", ")
              : null;
          const ssMeta = isSsStartRow
            ? `Social Security begins — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
            : hasSs
              ? `Incl. SS income — ${formatCurrency(deflate(dyr.ssIncome, yr.year))}/yr${ssDetail ? ` (${ssDetail})` : ""}`
              : undefined;
          // R47 follow-up: full satisfaction status (checkmark/shortfall/
          // excess wording), not just the bare amount — parity with the
          // chart tooltip's rmd block (see tooltip-renderer.tsx). Checkmark
          // shows whenever the RMD was actually met, not just the notable
          // excess/QCD case — silence isn't a reliable enough signal of
          // "satisfied" on its own (user feedback, 2026-08-28).
          const rmdShortfallAmount = dyr.rmdShortfallAmount ?? 0;
          const rmdExcessAmount = dyr.rmdExcessAmount ?? 0;
          const rmdSatisfied = rmdShortfallAmount <= 0;
          return renderTooltip({
            kind: "money",
            header: "Total Withdrawals",
            meta: ssMeta,
            shortfall: dyr.unmetNeedMaterial
              ? {
                  amount: deflate(dyr.unmetNeed ?? 0, yr.year),
                  nonRetirementAmount:
                    (dyr.nonRetirementShortfall ?? 0) > 0
                      ? deflate(dyr.nonRetirementShortfall!, yr.year)
                      : undefined,
                  penaltyAvoidedAmount:
                    (dyr.penaltyAvoidedShortfall ?? 0) > 0
                      ? deflate(dyr.penaltyAvoidedShortfall!, yr.year)
                      : undefined,
                }
              : undefined,
            rmd: hasRmd
              ? {
                  amount: deflate(dyr.rmdAmount, yr.year),
                  isStartYear: isRmdStartRow,
                  satisfiedNotably: rmdSatisfied,
                  shortfallAmount: deflate(rmdShortfallAmount, yr.year),
                  excessAmount: deflate(rmdExcessAmount, yr.year),
                  excessMode:
                    engineSettings?.rmdExcessHandling === "spend"
                      ? "spend"
                      : "reinvest",
                  qcdAmount:
                    (dyr.qcdAmount ?? 0) > 0
                      ? deflate(dyr.qcdAmount!, yr.year)
                      : undefined,
                  divisorDetail: formatRmdDivisorDetail(dyr, deflate, yr.year),
                }
              : undefined,
            strategyEvent: (() => {
              if (!dyr.strategyAction) return undefined;
              const style =
                buildStrategyEventStyle(engineSettings)[dyr.strategyAction];
              return style
                ? { color: style.color, text: style.tooltipText }
                : undefined;
            })(),
            items: items.length > 0 ? items : undefined,
            growth:
              Math.abs(totalGrowth) > 1
                ? {
                    amount: deflate(totalGrowth, yr.year),
                  }
                : undefined,
            withdrawals:
              dyr.taxCost > 0
                ? {
                    amount: deflate(dyr.totalWithdrawal, yr.year),
                    taxCost: deflate(dyr.taxCost, yr.year),
                  }
                : undefined,
            budget: budgetProfileName
              ? {
                  profile: budgetProfileName,
                  amount: deflate(dyr.projectedExpenses, yr.year),
                }
              : undefined,
            overrideNote: decumOverrideNotes
              ? `Override: ${decumOverrideNotes}`
              : undefined,
          });
        })()}
        side="top"
        maxWidth={460}
      >
        <td
          className={`text-right py-1.5 px-2 font-medium ${
            totalLumpSum > 0 && totalLumpSum > dyr.totalWithdrawal
              ? "text-green-600"
              : dyr.totalWithdrawal > 0 &&
                  dyr.totalWithdrawal < dyr.targetWithdrawal
                ? "text-amber-500"
                : dyr.totalWithdrawal > 0
                  ? "text-red-600"
                  : dyr.endBalance < 1 && dyr.projectedExpenses > 0
                    ? "text-red-400 italic"
                    : "text-muted"
          }`}
        >
          {(() => {
            const net = deflate(totalLumpSum - dyr.totalWithdrawal, yr.year);
            if (totalLumpSum > 0 && dyr.totalWithdrawal > 0) {
              return net >= 0
                ? `+${formatCurrency(net)}`
                : `-${formatCurrency(Math.abs(net))}`;
            }
            if (totalLumpSum > 0) {
              return `+${formatCurrency(deflate(totalLumpSum, yr.year))}`;
            }
            if (dyr.totalWithdrawal > 0) {
              return `-${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`;
            }
            return dyr.endBalance < 1 && dyr.projectedExpenses > 0
              ? "depleted"
              : "---";
          })()}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.balanceTaxTypes.has(t))
          .map((bucket) => {
            const bal = dpt
              ? dpt.byTaxType[bucket]
              : yr.balanceByTaxType[bucket];
            const dptTotal = dpt ? dpt.balance : yr.endBalance;
            const pct = percentOf(bal, dptTotal);
            // Compute growth for this tax bucket from individualAccountBalances
            const bucketIabs = yr.individualAccountBalances ?? [];
            const bucketAccts = (
              dpt
                ? bucketIabs.filter((ia) => ia.ownerPersonId === personFilter)
                : bucketIabs
            ).filter((ia) => iaBelongsToBucket(ia, bucket));
            const bucketGrowth = bucketAccts.reduce(
              (s, ia) => s + ia.growth,
              0,
            );
            return (
              <Tooltip
                key={bucket}
                content={(() => {
                  const wdLineItems: TooltipLineItem[] = [];
                  if (!dpt) {
                    const bucketTaxField = bucketSlotMap[bucket]?.taxField;
                    for (const slot of dyr.slots) {
                      const wd = slotBucketWithdrawal(slot, bucket);
                      if (wd > 0) {
                        wdLineItems.push({
                          label:
                            catDisplayLabel[slot.category] ?? slot.category,
                          amount: deflate(wd, yr.year),
                          prefix: "-",
                          taxType: bucketTaxField
                            ? itemTaxType(slot.category, bucketTaxField)
                            : undefined,
                          color: "red",
                        });
                      }
                    }
                  } else {
                    // Person-filtered: show per-account withdrawals from individual account data
                    for (const ia of bucketAccts) {
                      const wd = ia.withdrawal ?? 0;
                      if (wd > 0) {
                        wdLineItems.push({
                          label: ia.name,
                          amount: deflate(wd, yr.year),
                          prefix: "-",
                          color: "red",
                        });
                      }
                    }
                  }
                  // Add lump sum items for this bucket
                  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
                  for (const ls of bucketLumps) {
                    wdLineItems.push({
                      label: ls.label ?? "Lump sum",
                      amount: deflate(ls.amount, yr.year),
                      prefix: "+",
                      color: "emerald",
                    });
                  }
                  // R46: same RMD-excess / QCD visibility as the
                  // contribution-view tooltips (per user follow-up — the
                  // BALANCE tooltip needs to explain its own number too,
                  // not just the contribution/withdrawal column). afterTax
                  // is where reinvested excess actually lands (or would
                  // have, under "spend"); preTax is where QCD money left
                  // from.
                  const bucketRmdExcess = yr.rmdExcessAmount ?? 0;
                  const bucketRmdMode = engineSettings?.rmdExcessHandling;
                  if (bucket === "afterTax" && bucketRmdExcess > 0.01) {
                    if (bucketRmdMode === "spend") {
                      wdLineItems.push({
                        label: "RMD excess spent (not reinvested)",
                        amount: deflate(bucketRmdExcess, yr.year),
                        color: "gray",
                      });
                    } else {
                      wdLineItems.push({
                        label: "RMD excess reinvested",
                        amount: deflate(bucketRmdExcess, yr.year),
                        prefix: "+",
                        color: "amber",
                      });
                    }
                  }
                  const bucketQcd = yr.qcdAmount ?? 0;
                  if (bucket === "preTax" && bucketQcd > 0.01) {
                    wdLineItems.push({
                      label: "QCD to charity (excluded from taxable income)",
                      amount: deflate(bucketQcd, yr.year),
                      prefix: "-",
                      color: "violet",
                    });
                  }
                  return renderTooltip({
                    kind: "money",
                    header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                    meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return`,
                    items: wdLineItems.length > 0 ? wdLineItems : undefined,
                    growth:
                      Math.abs(bucketGrowth) > 1
                        ? {
                            amount: deflate(bucketGrowth, yr.year),
                          }
                        : undefined,
                  });
                })()}
                side="top"
              >
                <td
                  className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                >
                  {formatCurrency(deflate(bal, yr.year))}
                </td>
              </Tooltip>
            );
          })
      ) : (
        <>
          {getAccountSegments()
            .map((seg) => ({
              key: seg.key,
              val: getSegmentBalance(yr.balanceByAccount, seg),
              color: accountTextColor(seg.category),
              label: seg.label,
            }))
            .filter((col) => visibleColumns.balanceAccts.has(col.key))
            .map((col) => {
              const catKey = colKeyParts(col.key).category;
              const bal = dpt ? (dpt.byAccount[col.key] ?? 0) : col.val;
              const dptTotalBal = dpt ? dpt.balance : yr.endBalance;
              const pct = percentOf(bal, dptTotalBal);
              // Compute authoritative total change from engine
              const decPrevYr = result.projectionByYear.find(
                (y) => y.year === yr.year - 1,
              );
              const decPrevPt = decPrevYr
                ? getPersonYearTotals(decPrevYr)
                : null;
              const decPrevVal = decPrevYr
                ? decPrevPt
                  ? (decPrevPt.byAccount[col.key] ?? 0)
                  : colBalance(decPrevYr.balanceByAccount, col.key)
                : 0;
              // Build account items as data
              const decAcctItems: TooltipLineItem[] = [];
              const decColTaxType = colEngineTaxType(col.key);
              // Use engine's individualAccountBalances
              const decIabs = (yr.individualAccountBalances ?? []).filter(
                (ia) =>
                  ia.category === catKey &&
                  (decColTaxType == null || ia.taxType === decColTaxType) &&
                  (!isPersonFiltered || ia.ownerPersonId === personFilter),
              );
              {
                // Compute from balance changes — data-driven, no routing layers
                const _decPrevIabs = decPrevYr?.individualAccountBalances ?? [];
                const seenDecAccts = new Set<string>();
                const decSplits: {
                  name: string;
                  entryTaxType: string;
                  balance: number;
                  growth: number;
                  withdrawal: number;
                }[] = [];
                for (const ia of decIabs) {
                  const dk = `${catKey}-${ia.name}-${ia.taxType}`;
                  if (seenDecAccts.has(dk)) continue;
                  seenDecAccts.add(dk);
                  decSplits.push({
                    name: ia.name,
                    entryTaxType: ia.taxType,
                    balance: ia.balance,
                    growth: ia.growth,
                    withdrawal: ia.withdrawal ?? 0,
                  });
                }
                const splitsTotal = decSplits.reduce(
                  (s, e) => s + e.balance,
                  0,
                );
                for (const {
                  name: acctName,
                  entryTaxType,
                  balance: spBal,
                  growth: spGrowth,
                } of decSplits) {
                  const frac = safeDivide(spBal, splitsTotal, 0);
                  const subItems: TooltipLineItem[] = [];
                  if (Math.abs(spGrowth) > 1)
                    subItems.push({
                      label: "growth",
                      amount: deflate(spGrowth, yr.year),
                      prefix: spGrowth >= 0 ? "+" : undefined,
                      color: spGrowth >= 0 ? "blue" : "red",
                    });
                  decAcctItems.push({
                    label: acctName,
                    amount: deflate(Math.max(0, spBal), yr.year),
                    percent: Math.round(frac * 100),
                    taxType: itemTaxType(catKey, entryTaxType),
                    sub: subItems.length > 0 ? subItems : undefined,
                  });
                }
              }
              // R46: same RMD-excess / QCD visibility as the taxType-view
              // balance tooltips and the contribution-view tooltips —
              // gated on the account-view column's own category rather
              // than a fixed bucket, so this fires no matter which
              // overflow/IRA-category column the segment maps to.
              const colRmdExcess = yr.rmdExcessAmount ?? 0;
              const colRmdMode = engineSettings?.rmdExcessHandling;
              if (
                colRmdExcess > 0.01 &&
                ACCOUNT_TYPE_CONFIG[catKey as AccountCategory].isOverflowTarget
              ) {
                if (colRmdMode === "spend") {
                  decAcctItems.push({
                    label: "RMD excess spent (not reinvested)",
                    amount: deflate(colRmdExcess, yr.year),
                    color: "gray",
                  });
                } else {
                  decAcctItems.push({
                    label: "RMD excess reinvested",
                    amount: deflate(colRmdExcess, yr.year),
                    prefix: "+",
                    color: "amber",
                  });
                }
              }
              const colQcd = yr.qcdAmount ?? 0;
              if (colQcd > 0.01 && isIraCategory(catKey)) {
                decAcctItems.push({
                  label: "QCD to charity (excluded from taxable income)",
                  amount: deflate(colQcd, yr.year),
                  prefix: "-",
                  color: "violet",
                });
              }
              // Calculate total withdrawal from slot data (data-driven via colWithdrawal)
              const decTotalWd = colWithdrawal(dyr.slots, col.key);
              // Sum growth from engine's individual account balances for this column
              const decSplitGrowth = decIabs.reduce(
                (s, ia) => s + ia.growth,
                0,
              );
              const decDeflatedBal = deflate(bal, yr.year);
              const decDeflatedPrev = decPrevYr
                ? deflate(decPrevVal, decPrevYr.year)
                : 0;
              const decDisplayChange = decPrevYr
                ? decDeflatedBal - decDeflatedPrev
                : deflate(decSplitGrowth - decTotalWd, yr.year);
              const decDisplayWd = deflate(decTotalWd, yr.year);
              const decDisplayGrowth = deflate(decSplitGrowth, yr.year);
              const decBoyBal = decPrevYr
                ? decDeflatedPrev
                : deflate(bal - decSplitGrowth + decTotalWd, yr.year);
              const decChangeParts: {
                label: string;
                amount: number;
                color: TipColor;
              }[] = [];
              if (Math.abs(decDisplayGrowth) > 1)
                decChangeParts.push({
                  label: "growth",
                  amount: decDisplayGrowth,
                  color: decDisplayGrowth >= 0 ? "blue" : "red",
                });
              if (decDisplayWd > 0)
                decChangeParts.push({
                  label: "withdrawn",
                  amount: -decDisplayWd,
                  color: "red",
                });
              return (
                <Tooltip
                  key={col.key}
                  content={renderTooltip({
                    kind: "money",
                    header: `${col.label}: ${pct}% of portfolio`,
                    meta: `${yr.year} · BoY: ${formatCurrency(decBoyBal)} → EoY: ${formatCurrency(decDeflatedBal)} · ${formatPercent(yr.returnRate, 1)} return`,
                    items: decAcctItems.length > 0 ? decAcctItems : undefined,
                    withdrawals:
                      decDisplayWd > 0 ? { amount: decDisplayWd } : undefined,
                    yearChange: {
                      total: decDeflatedBal,
                      change: decDisplayChange,
                      parts:
                        decChangeParts.length > 0 ? decChangeParts : undefined,
                    },
                    legend: [
                      {
                        label: "Blue = growth",
                        color: "blue",
                      },
                      {
                        label: "Red = withdrawals",
                        color: "red",
                      },
                    ],
                  })}
                  side="top"
                >
                  <td className={`text-right py-1.5 px-2 ${col.color}`}>
                    {formatCurrency(deflate(bal, yr.year))}
                  </td>
                </Tooltip>
              );
            })}
        </>
      )}
      <Tooltip
        content={(() => {
          const tb = dpt ? dpt.balance : yr.endBalance;
          const iabs = yr.individualAccountBalances ?? [];
          const totalGrowth = (
            dpt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : iabs
          ).reduce((s, ia) => s + ia.growth, 0);
          if (tb < 1 && Math.abs(totalGrowth) < 1)
            return renderTooltip({
              kind: "info",
              lines: [
                {
                  text: "Portfolio depleted",
                  style: "note",
                  color: "gray",
                },
              ],
            });
          const items: TooltipLineItem[] = (
            ["preTax", "taxFree", "hsa", "afterTax"] as const
          ).map((b) => {
            const bVal = dpt ? dpt.byTaxType[b] : yr.balanceByTaxType[b];
            return {
              label: taxTypeLabel(b),
              amount: deflate(bVal, yr.year),
              percent: percentOf(bVal, tb),
            };
          });
          return renderTooltip({
            kind: "money",
            header: "Portfolio Balance",
            items,
            growth:
              Math.abs(totalGrowth) > 1
                ? {
                    amount: deflate(totalGrowth, yr.year),
                  }
                : undefined,
          });
        })()}
        side="top"
      >
        <td className="text-right py-1.5 px-2 font-semibold">
          {formatCurrency(
            Math.max(0, deflate(dpt ? dpt.balance : yr.endBalance, yr.year)),
          )}
        </td>
      </Tooltip>
      {renderMcCell(
        yr,
        deflate(dpt ? dpt.balance : yr.endBalance, yr.year),
        mcCellOpts,
      )}
      <td className="py-1.5 pl-2 text-caption text-faint whitespace-nowrap border-l border-subtle">
        {dyr.taxCost > 0 && (
          <Tooltip
            content="Eff. rate = total tax / total withdrawal. Traditional: marginal rate. Brokerage: LTCG rate. Roth growth beyond basis: ordinary rate. Once at the bracket cap, the engine picks whichever's cheaper that year."
            side="left"
            maxWidth={240}
          >
            <span className="text-red-400">
              ~{formatCurrency(deflate(dyr.taxCost, yr.year))} tax (
              {formatPercent(dyr.effectiveTaxRate, 1)} eff.)
            </span>
          </Tooltip>
        )}
        {diagMode && dyr.grossUpFactor != null && (
          <Tooltip
            lines={[
              `Expenses: ${formatCurrency(deflate(dyr.projectedExpenses, yr.year))}`,
              `SS Income: ${formatCurrency(deflate(dyr.ssIncome ?? 0, yr.year))}`,
              `After-tax need: ${formatCurrency(deflate(dyr.afterTaxNeed ?? 0, yr.year))}`,
              `Tax rate: ${formatPercent(dyr.effectiveTaxRate, 2)} (trad ${formatPercent(dyr.estTraditionalPortion ?? 0, 0)} of portfolio)`,
              `Gross-up: ×${(dyr.grossUpFactor ?? 1).toFixed(3)}`,
              `Target withdrawal: ${formatCurrency(deflate(dyr.targetWithdrawal, yr.year))}`,
              `Actual withdrawal: ${formatCurrency(deflate(dyr.totalWithdrawal, yr.year))}`,
              ...(dyr.projectedExpenses > 0 &&
              dyr.totalWithdrawal < dyr.projectedExpenses
                ? [
                    `SHORTFALL: ${formatCurrency(deflate(dyr.projectedExpenses - dyr.totalWithdrawal, yr.year))}/yr unfunded`,
                  ]
                : []),
              ...(dyr.bracketTraditionalCap != null
                ? [
                    `Bracket trad cap: ${formatCurrency(deflate(dyr.bracketTraditionalCap, yr.year))}`,
                  ]
                : []),
              ...(dyr.unmetNeed != null && dyr.unmetNeed > 0
                ? [
                    `UNMET NEED: ${formatCurrency(deflate(dyr.unmetNeed, yr.year))}`,
                  ]
                : []),
              `Routing: ${dyr.config.withdrawalRoutingMode}`,
              ...(dyr.preWithdrawalAcctBal
                ? getAllCategories()
                    .filter(
                      (c) =>
                        ACCOUNT_TYPE_CONFIG[c as AccountCategory]
                          ?.supportsRothSplit,
                    )
                    .map((c) => {
                      const bal =
                        dyr.preWithdrawalAcctBal![c as AccountCategory];
                      return bal && "roth" in bal
                        ? // eslint-disable-next-line no-restricted-syntax -- type narrowing for untyped API response
                          ` ${c} pre-wd: trad=${formatCurrency(deflate((bal as unknown as Record<string, number>).traditional ?? 0, yr.year))}, roth=${formatCurrency(deflate((bal as unknown as Record<string, number>).roth ?? 0, yr.year))}`
                        : ` ${c} pre-wd: n/a`;
                    })
                : []),
              ...dyr.slots.map(
                (s) =>
                  ` ${s.category}: -${formatCurrency(deflate(s.withdrawal, yr.year))} (trad ${formatCurrency(deflate(s.traditionalWithdrawal, yr.year))}, roth ${formatCurrency(deflate(s.rothWithdrawal, yr.year))})`,
              ),
              ...(dyr.rmdAmount > 0
                ? [
                    `RMD: ${formatCurrency(deflate(dyr.rmdAmount, yr.year))}${dyr.rmdOverrodeRouting ? " (forced)" : ""}`,
                  ]
                : []),
              ...(dyr.taxableSS > 0
                ? [
                    `Taxable SS: ${formatCurrency(deflate(dyr.taxableSS, yr.year))} of ${formatCurrency(deflate(dyr.ssIncome ?? 0, yr.year))}`,
                  ]
                : []),
              `LTCG rate: ${formatPercent(dyr.ltcgRate, 0)}`,
              ...(dyr.rothConversionAmount > 0
                ? [
                    `Roth conv: ${formatCurrency(deflate(dyr.rothConversionAmount, yr.year))} (tax: ${formatCurrency(deflate(dyr.rothConversionTaxCost, yr.year))})`,
                  ]
                : []),
              ...(dyr.strategyAction
                ? [`Strategy: ${dyr.strategyAction}`]
                : []),
              ...(dyr.irmaaCost > 0
                ? [
                    `IRMAA: ${formatCurrency(deflate(dyr.irmaaCost, yr.year))}/yr surcharge`,
                  ]
                : []),
              ...(dyr.acaSubsidyPreserved
                ? [
                    `ACA: subsidy preserved (${formatCurrency(deflate(dyr.acaMagiHeadroom, yr.year))} headroom)`,
                  ]
                : []),
              ...(!dyr.acaSubsidyPreserved &&
              dyr.acaMagiHeadroom === 0 &&
              yr.age < 65
                ? [`ACA: subsidy lost`]
                : []),
            ]}
            side="left"
            maxWidth={320}
          >
            {/* This "diag" label is the Tooltip's TRIGGER, rendered on the
                page's own (theme-adaptive) background — NOT inside the
                tooltip's always-dark popup content. blue-300 has a real
                --c-blue-300 override (globals.css) and correctly tracks
                page theme here, unlike tipColorClass's shades (used for
                text INSIDE the dark popup, see cards/projection/utils.ts). */}
            <span className="text-blue-300 ml-1 cursor-help">diag</span>
          </Tooltip>
        )}
        {dyr.warnings.length > 0 && (
          <Tooltip
            content={renderTooltip({
              kind: "info",
              lines: dyr.warnings.map((w) => ({
                text: w,
                style: "note" as const,
              })),
            })}
            side="left"
          >
            <span className="text-amber-500 ml-1">
              {dyr.warnings.length} warning
              {dyr.warnings.length > 1 ? "s" : ""}
            </span>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
