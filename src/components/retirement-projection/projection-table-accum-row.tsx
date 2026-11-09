/** Renders a single accumulation-phase table row with salary, contribution breakdowns, balance columns, and MC cell. */
import React, { useRef } from "react";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { Tooltip } from "@/components/ui/tooltip";
import { BalanceCell } from "./balance-cell";
import {
  accountTextColor,
  taxTypeTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import {
  formatCurrency,
  formatPercent,
  maskAmountsInText,
} from "@/lib/utils/format";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  EngineAccumulationYear,
  AccumulationSlot,
} from "@/lib/pure/engine/types";
import {
  getAccountSegments,
  getAllCategories,
  getAccountTypeConfig,
  getDisplayConfig,
  isOverflowTarget,
} from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/pure/accounts/account-balance";
import type { TipColor, TooltipLineItem } from "./types";
import { catDisplayLabel } from "./projection-display";
import { rowTotal } from "./parent-category-filter";
import {
  itemTaxType,
  colKeyParts,
  colBalance,
  colEngineTaxType,
  slotsColumnBalanceInflow,
  percentOf,
  proRateMonths,
  specFrac,
  matchFracOf,
  computeColumnChange,
  computeAccountSplits,
} from "./projection-columns";
import {
  bucketSlotMap,
  _singleBucketCategories,
  slotBucketContribution,
  slotsBucketBalanceInflow,
  filterSpecsForBucket,
  iaBelongsToBucket,
} from "./bucket-slots";
import { safeDivide } from "@/lib/utils/math";
import type { ProjectionState } from "./projection-table-types";
import {
  renderSimulationCell,
  type RenderSimulationCellOptions,
} from "./projection-table-mc-cell";
import {
  yearAgesTooltip,
  salaryTooltip,
  displaySalary,
  savingsRateTooltip,
} from "./projection-table-accum-row.model";
import {
  categoryContributionTooltip,
  overflowContributionTooltip,
  taxTypeContributionTooltip,
} from "./projection-table-accum-contributions.model";
import {
  totalContributionTooltip,
  accountBalanceTooltip,
} from "./projection-table-accum-balances.model";

type AccumulationRowProps = {
  /** A link landed on this year — scrolled to and ringed. */
  focused?: boolean;
  yr: EngineAccumulationYear;
  state: ProjectionState;
  parentCategoryFilter?: string;
  /** Rate counts the employer match (the shared savings-rate switch). */
  rateIncludesMatch?: boolean;
  isPhaseTransition: boolean;
  hasOverride: boolean;
  accumOverrideNotes?: string;
  salaryOverrideNotes?: string | null;
  budgetOverrideNotes?: string | null;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  people?: { id: number; name: string; birthYear: number }[];
  simulationCellOpts: RenderSimulationCellOptions;
};

/** SAVE, HOLD when nobody saves, and + DRAW when accounts pay in too. */
function GapYearPhase({ yearRow }: { yearRow: EngineAccumulationYear }) {
  return (
    <span>
      {yearRow.savingStopped ? (
        <span className="text-caption font-medium text-sky-600">HOLD</span>
      ) : (
        <span className="text-caption font-medium text-green-600">SAVE</span>
      )}
      {(yearRow.gapDraw?.withdrawal ?? 0) > 0 && (
        <span className="text-caption ml-1 font-medium text-amber-600">
          + DRAW
        </span>
      )}
    </span>
  );
}

/** The portfolio total's tooltip, by tax type. */
function portfolioBalanceTooltip(
  pt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  yearRow: EngineAccumulationYear,
  deflate: ProjectionState["deflate"],
  renderTooltip: ProjectionState["renderTooltip"],
  contributionSpecs: ProjectionState["contribSpecs"],
) {
  const ptBalance = pt ? pt.balance : rowTotal(yearRow);
  const items: TooltipLineItem[] = (
    ["preTax", "taxFree", "hsa", "afterTax"] as const
  ).map((b) => {
    const bVal = pt ? pt.byTaxType[b] : yearRow.balanceByTaxType[b];
    return {
      label: taxTypeLabel(b),
      amount: deflate(bVal, yearRow.year),
      percent: percentOf(bVal, ptBalance),
    };
  });
  return renderTooltip({
    kind: "money",
    header: "Portfolio Balance",
    items,
    proRate:
      yearRow.proRateFraction != null
        ? (() => {
            const totalAnnual =
              contributionSpecs?.reduce(
                (s, sp) => s + (sp.baseAnnual || 0),
                0,
              ) ?? 0;
            return totalAnnual > 0
              ? {
                  months: proRateMonths(yearRow.proRateFraction),
                  annualAmount: deflate(totalAnnual, yearRow.year),
                  proRatedAmount: deflate(yearRow.totalEmployee, yearRow.year),
                }
              : undefined;
          })()
        : undefined,
  });
}

export function AccumulationRow({
  yr,
  focused = false,
  state,
  parentCategoryFilter,
  rateIncludesMatch = false,
  isPhaseTransition,
  hasOverride,
  accumOverrideNotes,
  salaryOverrideNotes,
  budgetOverrideNotes,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  people,
  simulationCellOpts,
}: AccumulationRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  useScrollToFocus(rowRef, focused);
  const {
    accumOverrides,
    balanceView,
    contributionView,
    diagMode: _diagMode,
    personFilter,
    isPersonFiltered,
    personFilterName,
    visibleColumns,
    deflate,
    getPersonYearTotals,
    baseYear: _baseYear,
    renderTooltip,
    enginePeople,
    engineSettings,
    enginePerPersonSettings,
    realDefaults: _realDefaults,
    contribSpecs,
    budgetProfileSummaries,
    result,
  } = state;

  if (!result) return null;

  const slotMap = new Map<AccountCategory, AccumulationSlot>(
    yr.slots.map((s) => [s.category, s]),
  );
  const pt = getPersonYearTotals(yr);
  // The accounts the row is showing (a person filter narrows them).
  const scopedIabs = (
    rows: NonNullable<typeof yr.individualAccountBalances>,
  ) => (pt ? rows.filter((ia) => ia.ownerPersonId === personFilter) : rows);
  const drawnTotal = (rows: NonNullable<typeof yr.individualAccountBalances>) =>
    scopedIabs(rows).reduce((t, ia) => t + (ia.draw?.withdrawal ?? 0), 0);
  const gapOut = yr.gapDraw
    ? (yr.individualAccountBalances?.length ?? 0) > 0
      ? drawnTotal(yr.individualAccountBalances!)
      : pt
        ? 0
        : yr.gapDraw.withdrawal
    : 0;
  return (
    <tr
      ref={rowRef}
      key={yr.year}
      className={`border-subtle hover:bg-surface-elevated/60 border-b transition-colors ${
        isPhaseTransition
          ? "bg-blue-50 font-medium"
          : hasOverride
            ? "bg-emerald-50"
            : yr.overflowToBrokerage > 0
              ? "bg-amber-50/50"
              : ""
      }`}
    >
      <Tooltip
        content={yearAgesTooltip(people, enginePeople, renderTooltip, yr)}
        side="top"
      >
        <td className="py-1.5 pr-2 whitespace-nowrap">
          {yr.year}
          {yr.proRateFraction != null && (
            <Tooltip
              content={`Partial year: only ${proRateMonths(yr.proRateFraction)} of 12 months remain. All values in this row reflect the remaining months, not the full year.`}
              side="right"
              maxWidth={220}
            >
              <span className="text-micro align-super text-blue-500">*</span>
            </Tooltip>
          )}
        </td>
      </Tooltip>
      <td className="px-2 py-1.5">
        <GapYearPhase yearRow={yr} />
      </td>
      <Tooltip
        content={salaryTooltip(
          result,
          yr,
          isPersonFiltered,
          enginePeople,
          personFilter,
          salaryOverrideNotes,
          engineSettings,
          enginePerPersonSettings,
          people,
          deflate,
          renderTooltip,
        )}
        side="top"
      >
        <td className="text-muted px-2 py-1.5 text-right">
          {displaySalary(
            yr,
            isPersonFiltered,
            enginePeople,
            personFilter,
            deflate,
          )}
        </td>
      </Tooltip>
      <Tooltip
        content={
          yr.projectedSalary > 0
            ? savingsRateTooltip(
                yr,
                rateIncludesMatch,
                deflate,
                parentCategoryFilter,
                accumOverrides,
                accumOverrideNotes,
                renderTooltip,
              )
            : undefined
        }
        side="top"
      >
        <td className="text-faint px-2 py-1.5 text-right">
          {yr.projectedSalary > 0
            ? formatPercent(
                safeDivide(
                  yr.totalEmployee + (rateIncludesMatch ? yr.totalEmployer : 0),
                  yr.proRateFraction != null && yr.proRateFraction > 0
                    ? yr.projectedSalary * yr.proRateFraction
                    : yr.projectedSalary,
                ),
                1,
              )
            : "---"}
        </td>
      </Tooltip>
      {contributionView === "account" ? (
        <>
          {getAllCategories()
            .filter(
              (c) =>
                !isOverflowTarget(c) && visibleColumns.contributionCats.has(c),
            )
            .map((cat) => {
              const slot = slotMap.get(cat);
              const rawEmp = slot?.employeeContrib ?? 0;
              const rawMatch = slot?.employerMatch ?? 0;
              const catContribution = pt?.byCategoryContribution[cat];
              const emp = catContribution ? catContribution.employee : rawEmp;
              const match = catContribution ? catContribution.match : rawMatch;
              const total = emp + match;
              // Build per-person breakdown for tooltip
              const catSpecs =
                contribSpecs?.filter((s) => s.category === cat) ?? [];
              const specTotal = catSpecs.reduce(
                (s, sp) => s + (sp.baseAnnual || 0),
                0,
              );
              const catLabel = catDisplayLabel[cat] ?? cat;
              const finalTooltip =
                emp > 0 || match > 0
                  ? categoryContributionTooltip(
                      catSpecs,
                      isPersonFiltered,
                      personFilter,
                      specTotal,
                      rawEmp,
                      deflate,
                      yr,
                      cat,
                      rawMatch,
                      personFilterName,
                      emp,
                      match,
                      renderTooltip,
                      catLabel,
                      slot,
                    )
                  : undefined;
              return (
                <Tooltip key={cat} content={finalTooltip} side="top">
                  <td
                    className={`px-2 py-1.5 text-right ${accountTextColor(cat)}`}
                  >
                    {formatCurrency(deflate(total, yr.year))}
                    {match > 0 && (
                      <span className="text-micro ml-px align-super text-green-600">
                        +m
                      </span>
                    )}
                    {getAccountTypeConfig(cat).hasIrsLimit &&
                      slot?.cappedByAccount && (
                        <Tooltip content="Account cap hit" side="top">
                          <span className="ml-0.5 text-amber-500">^</span>
                        </Tooltip>
                      )}
                  </td>
                </Tooltip>
              );
            })}
          {getAllCategories()
            .filter(
              (c) =>
                isOverflowTarget(c) && visibleColumns.contributionCats.has(c),
            )
            .map((ofCat) => {
              const bSlot = slotMap.get(ofCat);
              const ofSpecs =
                contribSpecs?.filter((s) => s.category === ofCat) ?? [];
              const ofLabel = getAccountTypeConfig(ofCat).displayLabel;
              const ofRawMatch = bSlot?.employerMatch ?? 0;
              // Person filter first; otherwise the slot (already scoped to
              // the page's accounts by filterYearByParentCategory).
              const ofContribution = pt?.byCategoryContribution[ofCat] ?? null;
              const ofEmp = ofContribution
                ? ofContribution.employee
                : (bSlot?.employeeContrib ?? 0);
              const ofMatch = ofContribution
                ? ofContribution.match
                : ofRawMatch;
              const finalOfTooltip =
                bSlot && (ofEmp > 0 || ofMatch > 0)
                  ? overflowContributionTooltip(
                      ofSpecs,
                      ofEmp,
                      ofMatch,
                      deflate,
                      yr,
                      ofCat,
                      renderTooltip,
                      ofLabel,
                    )
                  : undefined;
              return (
                <Tooltip key={ofCat} content={finalOfTooltip} side="top">
                  <td
                    className={`px-2 py-1.5 text-right ${accountTextColor(ofCat)}${yr.overflowToBrokerage > 0 ? "font-medium" : ""}`}
                  >
                    {ofEmp + ofMatch > 0
                      ? formatCurrency(deflate(ofEmp + ofMatch, yr.year))
                      : "---"}
                    {ofMatch > 0 && (
                      <span className="text-micro ml-px align-super text-green-600">
                        +m
                      </span>
                    )}
                  </td>
                </Tooltip>
              );
            })}
        </>
      ) : (
        /* Contribution columns by tax type */
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.contributionTaxTypes.has(t))
          .map((bucket) => {
            // Build per-spec items for this tax bucket
            let bucketTotal = 0;
            let bucketMatch = 0;
            let bucketAssocMatch = 0;
            const items: TooltipLineItem[] = [];
            for (const slot of yr.slots) {
              const cat = slot.category;
              const allCatSpecs =
                contribSpecs?.filter((s) => s.category === cat) ?? [];
              const allMatchAnnual = allCatSpecs.reduce(
                (s, sp) => s + (sp.matchAnnual ?? 0),
                0,
              );
              // Determine which specs and slot amounts apply to this bucket (data-driven via bucketSlotMap)
              const slotEmp = slotBucketContribution(slot, bucket);
              const slotMatch = slot.employerMatch;
              const bucketSpecs = filterSpecsForBucket(allCatSpecs, bucket);
              const isAssoc = bucketSlotMap[bucket]?.matchIsAssociated ?? false;
              if (slotEmp === 0 && slotMatch === 0) continue;
              if (bucketSpecs.length === 0) continue;
              // Distribute slot amounts proportionally across specs
              const specBaseTotal = bucketSpecs.reduce(
                (s, sp) => s + (sp.baseAnnual || 0),
                0,
              );
              const catLabel = catDisplayLabel[cat] ?? cat;
              for (const sp of bucketSpecs) {
                if (isPersonFiltered && sp.personId !== personFilter) continue;
                const frac = specFrac({
                  baseAnnual: sp.baseAnnual || 0,
                  specTotal: specBaseTotal,
                  specCount: bucketSpecs.length,
                });
                const emp = slotEmp * frac;
                const mFrac = matchFracOf({
                  matchAnnual: sp.matchAnnual ?? 0,
                  allMatchAnnual,
                });
                let mtch = 0;
                let assocMtch = 0;
                if (isAssoc) {
                  assocMtch = slotMatch * mFrac;
                } else {
                  mtch = slotMatch * mFrac;
                }
                if (emp > 0 || mtch > 0 || assocMtch > 0) {
                  items.push({
                    label: sp.ownerName
                      ? `${sp.ownerName} ${catLabel}`
                      : catLabel,
                    amount: deflate(emp, yr.year),
                    taxType: itemTaxType(cat, sp.taxTreatment),
                    match: mtch > 0 ? deflate(mtch, yr.year) : undefined,
                    matchLabel: getDisplayConfig(
                      cat,
                      sp.name !== cat ? sp.name : undefined,
                    ).employerMatchLabel,
                    associatedMatch:
                      assocMtch > 0 ? deflate(assocMtch, yr.year) : undefined,
                  });
                  bucketTotal += emp;
                  bucketMatch += mtch;
                  bucketAssocMatch += assocMtch;
                }
              }
            }
            const total = bucketTotal + bucketMatch;
            // Compute annual (full-year) amount from specs for this bucket (data-driven)
            let bucketAnnual = 0;
            const bMap = bucketSlotMap[bucket];
            for (const slot of yr.slots) {
              // Skip slots that don't contribute to this bucket
              if (bMap?.categoryFilter && slot.category !== bMap.categoryFilter)
                continue;
              if (
                !bMap?.categoryFilter &&
                _singleBucketCategories.has(slot.category)
              )
                continue;
              const catSpAll =
                contribSpecs?.filter((s) => s.category === slot.category) ?? [];
              const filtered = filterSpecsForBucket(catSpAll, bucket);
              bucketAnnual += filtered.reduce(
                (s, sp) => s + (sp.baseAnnual || 0),
                0,
              );
            }
            return (
              <Tooltip
                key={bucket}
                content={
                  items.length > 0
                    ? taxTypeContributionTooltip(
                        renderTooltip,
                        bucket,
                        items,
                        deflate,
                        bucketTotal,
                        yr,
                        bucketMatch,
                        bucketAssocMatch,
                        bucketAnnual,
                      )
                    : undefined
                }
                side="top"
              >
                <td
                  className={`px-2 py-1.5 text-right ${taxTypeTextColor(bucket)}`}
                >
                  {total > 0 ? formatCurrency(deflate(total, yr.year)) : "---"}
                  {(bucketMatch > 0 || bucketAssocMatch > 0) && (
                    <span className="text-micro ml-px align-super text-green-600">
                      +m
                    </span>
                  )}
                </td>
              </Tooltip>
            );
          })
      )}
      <Tooltip
        content={totalContributionTooltip(
          yr,
          pt,
          personFilter,
          accumulationBudgetProfileId,
          budgetProfileSummaries,
          deflate,
          accumulationExpenseOverride,
          budgetOverrideNotes,
          accumulationBudgetColumn,
          drawnTotal,
          scopedIabs,
          renderTooltip,
          isPersonFiltered,
          personFilterName,
          accumOverrideNotes,
          accumOverrides,
          contribSpecs,
        )}
        side="top"
      >
        <td className="px-2 py-1.5 text-right font-medium">
          {formatCurrency(
            deflate(
              pt ? pt.contribution : yr.totalEmployee + yr.totalEmployer,
              yr.year,
            ),
          )}
          {yr.totalEmployer > 0 && (
            <span className="text-micro ml-px align-super text-green-600">
              +m
            </span>
          )}
          {gapOut > 0 && (
            <div className="text-caption text-amber-600">
              −{formatCurrency(deflate(gapOut, yr.year))}
            </div>
          )}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (["preTax", "taxFree", "hsa", "afterTax"] as const)
          .filter((t) => visibleColumns.balanceTaxTypes.has(t))
          .map((bucket) => {
            const balance = pt
              ? pt.byTaxType[bucket]
              : yr.balanceByTaxType[bucket];
            const totalBalance = pt ? pt.balance : rowTotal(yr);
            const pct = percentOf(balance, totalBalance);
            // Compute authoritative total change from engine's year-over-year balance
            const previousYear = result.projectionByYear.find(
              (y) => y.year === yr.year - 1,
            );
            const prevPt = previousYear
              ? getPersonYearTotals(previousYear)
              : null;
            const prevBucketBalance = previousYear
              ? prevPt
                ? prevPt.byTaxType[bucket]
                : previousYear.balanceByTaxType[bucket]
              : 0;
            // Compute splitContribution from authoritative slot data (mirrors engine balance routing)
            const splitContribution = slotsBucketBalanceInflow(
              yr.slots,
              bucket,
            );
            // Build per-account items from individual account balances (for balance/growth detail)
            const bucketAccounts = (yr.individualAccountBalances ?? []).filter(
              (ia) =>
                iaBelongsToBucket(ia, bucket) &&
                (!isPersonFiltered || ia.ownerPersonId === personFilter),
            );
            const { splits: bucketSplits, splitGrowth } =
              computeAccountSplits(bucketAccounts);
            const accountItems: TooltipLineItem[] = bucketSplits.map((sp) => {
              const subItems: TooltipLineItem[] = [];
              if (sp.contribution > 1)
                subItems.push({
                  label: "contrib",
                  amount: deflate(sp.contribution, yr.year),
                  prefix: "+",
                  color: "green",
                });
              if (Math.abs(sp.growth) > 1)
                subItems.push({
                  label: "growth",
                  amount: deflate(sp.growth, yr.year),
                  prefix: sp.growth >= 0 ? "+" : undefined,
                  color: sp.growth >= 0 ? "blue" : "red",
                });
              return {
                label: sp.name,
                amount: deflate(sp.balance, yr.year),
                taxType: itemTaxType(sp.category, sp.taxType),
                sub: subItems.length > 0 ? subItems : undefined,
              };
            });
            const deflatedBalance = deflate(balance, yr.year);
            const {
              displayChange,
              displayContribution,
              displayGrowth,
              boyBalance,
            } = computeColumnChange({
              deflate,
              balance,
              year: yr.year,
              prev: previousYear
                ? {
                    balance: prevBucketBalance,
                    year: previousYear.year,
                  }
                : null,
              splitContribution,
              splitGrowth,
            });
            const changeParts: {
              label: string;
              amount: number;
              color: TipColor;
            }[] = [];
            if (displayContribution > 0)
              changeParts.push({
                label: "contrib",
                amount: displayContribution,
                color: "green",
              });
            if (Math.abs(displayGrowth) > 1)
              changeParts.push({
                label: "growth",
                amount: displayGrowth,
                color: displayGrowth >= 0 ? "blue" : "red",
              });
            const tooltipContent =
              accountItems.length > 0
                ? renderTooltip({
                    kind: "money",
                    header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                    meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return${yr.proRateFraction != null && yr.proRateFraction > 0 ? ` (${formatPercent(yr.annualizedReturnRate, 1)} annual)` : ""}`,
                    meta2: `BoY: ${formatCurrency(boyBalance)} → EoY: ${formatCurrency(deflatedBalance)}`,
                    items: accountItems,
                    yearChange: {
                      total: deflatedBalance,
                      change: displayChange,
                      parts: changeParts.length > 0 ? changeParts : undefined,
                    },
                    proRate:
                      yr.proRateFraction != null && yr.proRateFraction > 0
                        ? {
                            months: proRateMonths(yr.proRateFraction),
                            annualAmount: deflate(
                              safeDivide(splitContribution, yr.proRateFraction),
                              yr.year,
                            ),
                            proRatedAmount: deflate(splitContribution, yr.year),
                          }
                        : undefined,
                    legend: [
                      {
                        label: "Green = contributions",
                        color: "green",
                      },
                      {
                        label: "Blue = growth",
                        color: "blue",
                      },
                    ],
                  })
                : undefined;
            return (
              <BalanceCell
                key={bucket}
                amount={deflate(balance, yr.year)}
                color={taxTypeTextColor(bucket)}
                tooltip={tooltipContent}
              />
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
            .filter((col) => visibleColumns.balanceAccounts.has(col.key))
            .map((col) => {
              const catKey = colKeyParts(col.key).category;
              const balance = pt ? (pt.byAccount[col.key] ?? 0) : col.val;
              const totalBalance = pt ? pt.balance : rowTotal(yr);
              const pct = percentOf(balance, totalBalance);
              // Filter by the exact taxType this column represents
              const colTaxType = colEngineTaxType(col.key);
              // Use engine's individualAccountBalances — includes all accounts
              // (not just snapshot), so contributions to new tax types appear.
              const colIabs = (yr.individualAccountBalances ?? []).filter(
                (ia) =>
                  ia.category === catKey &&
                  (colTaxType == null || ia.taxType === colTaxType) &&
                  (!isPersonFiltered || ia.ownerPersonId === personFilter),
              );
              // Get previous year's value for this column from the engine
              const columnPreviousYear = result.projectionByYear.find(
                (y) => y.year === yr.year - 1,
              );
              const colPrevPt = columnPreviousYear
                ? getPersonYearTotals(columnPreviousYear)
                : null;
              const colPrevVal = columnPreviousYear
                ? colPrevPt
                  ? (colPrevPt.byAccount[col.key] ?? 0)
                  : colBalance(columnPreviousYear.balanceByAccount, col.key)
                : 0;
              // splitContribution from authoritative slot data (mirrors engine balance routing)
              const colSplitContribution = slotsColumnBalanceInflow(
                yr.slots,
                col.key,
              );
              // Per-account splits for balance/growth detail
              const { splits, splitGrowth: colSplitGrowth } =
                computeAccountSplits(colIabs);
              const colSplitsTotal = splits.reduce(
                (s, sp) => s + sp.balance,
                0,
              );
              // Total change = difference of deflated balances (matches table rows)
              const {
                displayChange: colDisplayChange,
                displayContribution: colDisplayContribution,
                displayGrowth: colDisplayGrowth,
                boyBalance: colBoyBalance,
              } = computeColumnChange({
                deflate,
                balance,
                year: yr.year,
                prev: columnPreviousYear
                  ? {
                      balance: colPrevVal,
                      year: columnPreviousYear.year,
                    }
                  : null,
                splitContribution: colSplitContribution,
                splitGrowth: colSplitGrowth,
              });
              const colDeflatedBalance = deflate(balance, yr.year);
              const tooltipContent =
                splits.length > 0
                  ? accountBalanceTooltip(
                      colDisplayContribution,
                      colDisplayGrowth,
                      splits,
                      colSplitsTotal,
                      deflate,
                      yr,
                      catKey,
                      renderTooltip,
                      col,
                      pct,
                      colBoyBalance,
                      colDeflatedBalance,
                      colDisplayChange,
                    )
                  : undefined;
              return (
                <BalanceCell
                  key={col.key}
                  amount={deflate(balance, yr.year)}
                  color={col.color}
                  tooltip={tooltipContent}
                />
              );
            })}
        </>
      )}
      <Tooltip
        content={
          rowTotal(yr) > 0
            ? portfolioBalanceTooltip(
                pt,
                yr,
                deflate,
                renderTooltip,
                contribSpecs,
              )
            : undefined
        }
        side="top"
      >
        <td className="px-2 py-1.5 text-right font-semibold">
          {formatCurrency(deflate(pt ? pt.balance : rowTotal(yr), yr.year))}
        </td>
      </Tooltip>
      {renderSimulationCell(
        yr,
        deflate(pt ? pt.balance : rowTotal(yr), yr.year),
        simulationCellOpts,
      )}
      <td className="text-caption text-faint border-subtle border-l py-1.5 pl-2 whitespace-nowrap">
        {yr.proRateFraction != null && (
          <Tooltip
            content={`Partial year — only ${proRateMonths(yr.proRateFraction)} months remain. All dollar values in this row show what's left for the year, not a full 12-month amount.`}
            side="left"
            maxWidth={240}
          >
            <span className="text-blue-500">
              {proRateMonths(yr.proRateFraction)}
              /12 mo remaining
            </span>
          </Tooltip>
        )}
        {yr.overflowToBrokerage > 0 && (
          <Tooltip
            content={`Contributions exceeded tax-advantaged limits by ${formatCurrency(deflate(yr.overflowToBrokerage, yr.year))} — excess routed to brokerage`}
            side="left"
            maxWidth={240}
          >
            <span className="text-amber-600">
              ↗ {formatCurrency(deflate(yr.overflowToBrokerage, yr.year))}{" "}
              overflow
            </span>
          </Tooltip>
        )}
        {yr.warnings.length > 0 && (
          <Tooltip
            content={renderTooltip({
              kind: "info",
              lines: yr.warnings.map((w) => ({
                text: maskAmountsInText(w),
                style: "note" as const,
              })),
            })}
            side="left"
          >
            <span className="ml-1 text-amber-500">
              {yr.warnings.length} warning
              {yr.warnings.length > 1 ? "s" : ""}
            </span>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
