/** The accumulation row's contribution total and balance columns: their
 *  tooltips, from the engine's year with the page's formatters. */
import type { EngineAccumulationYear } from "@/lib/pure/engine/types";
import type { ProjectionState } from "./projection-table-types";
import type { TipColor, TooltipLineItem } from "./types";
import type { computeAccountSplits } from "./utils";
import {
  contributionTaxTypeTotals,
  gapDrawnItems,
} from "./projection-table-accum-row.model";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { itemTaxType, percentOf, proRateMonths } from "./utils";
import { shortfallFloor } from "@/lib/pure/engine";

/** The contribution total's tooltip: what went in, what came out, growth and budget. */
export function totalContributionTooltip(
  yearRow: EngineAccumulationYear,
  pt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  personFilter: ProjectionState["personFilter"],
  accumulationBudgetProfileId: number | undefined,
  budgetProfileSummaries: ProjectionState["budgetProfileSummaries"],
  deflate: ProjectionState["deflate"],
  accumulationExpenseOverride: number | undefined,
  budgetOverrideNotes: string | null | undefined,
  accumulationBudgetColumn: number | undefined,
  drawnTotal: (
    rows: NonNullable<EngineAccumulationYear["individualAccountBalances"]>,
  ) => number,
  scopedIabs: (
    rows: NonNullable<EngineAccumulationYear["individualAccountBalances"]>,
  ) => NonNullable<EngineAccumulationYear["individualAccountBalances"]>,
  renderTooltip: ProjectionState["renderTooltip"],
  isPersonFiltered: ProjectionState["isPersonFiltered"],
  personFilterName: ProjectionState["personFilterName"],
  accumOverrideNotes: string | undefined,
  accumOverrides: ProjectionState["accumOverrides"],
  contributionSpecs: ProjectionState["contribSpecs"],
) {
  const iabs = yearRow.individualAccountBalances ?? [];
  const totalGrowth = (
    pt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : iabs
  ).reduce((s, ia) => s + ia.growth, 0);
  const accBudgetProfile =
    accumulationBudgetProfileId != null
      ? budgetProfileSummaries?.find(
          (p) => p.id === accumulationBudgetProfileId,
        )
      : undefined;
  const mine = pt ? iabs.filter((ia) => ia.ownerPersonId === personFilter) : [];
  const empAmount = deflate(
    pt ? pt.contribution : yearRow.totalEmployee,
    yearRow.year,
  );
  const matchAmount = pt
    ? deflate(
        mine.reduce((s, ia) => s + ia.employerMatch, 0),
        yearRow.year,
      )
    : yearRow.totalEmployer > 0
      ? deflate(yearRow.totalEmployer, yearRow.year)
      : 0;
  const budgetProfileName =
    accumulationExpenseOverride != null
      ? `Set for this year${yearRow.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
      : accBudgetProfile
        ? `${accBudgetProfile.name}${accumulationBudgetColumn != null && accBudgetProfile.columnLabels[accumulationBudgetColumn] ? ` (${accBudgetProfile.columnLabels[accumulationBudgetColumn]})` : ""}${yearRow.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
        : undefined;
  // Build per-bucket items from slots (shows all tax types that have contributions)
  const inOutItems: TooltipLineItem[] = [];
  if (matchAmount > 0)
    inOutItems.push({
      label: "Match",
      amount: matchAmount,
      color: "green",
    });
  inOutItems.push(...contributionTaxTypeTotals(yearRow, pt, mine, deflate));
  // A year a paycheck is gone: money comes out as well as in. With
  // a person or category filter only the accounts shown count, and
  // the household's figures (tax, the why) are left out.
  const gap = yearRow.gapDraw;
  const gapScoped = !!gap && drawnTotal(iabs) < gap.withdrawal - 0.5;
  if (gap) {
    inOutItems.push(...gapDrawnItems(yearRow, scopedIabs(iabs), deflate));
  }
  const money = (v: number) => formatCurrency(deflate(v, yearRow.year));
  const gapMeta = gap
    ? gap.withdrawal > 0
      ? `A paycheck is gone: pay ${money(gap.pay)}${gap.ssIncome > 0 ? ` and Social Security ${money(gap.ssIncome)}` : ""}, less ${money(gap.taxOnIncome)} tax and what's saved, leave spending ${money(gap.need)} short, so it's withdrawn`
      : gap.spendingCut > 0
        ? `A paycheck is gone: you chose not to withdraw, so spending runs ${money(gap.spendingCut)} under budget`
        : undefined
    : undefined;
  return renderTooltip({
    kind: "money",
    header: `${isPersonFiltered ? personFilterName : "Employee"}: ${formatCurrency(empAmount)}`,
    meta: gapScoped ? undefined : gapMeta,
    shortfall:
      gap && !gapScoped && gap.unmetNeed >= shortfallFloor(gap.need)
        ? { amount: deflate(gap.unmetNeed, yearRow.year) }
        : undefined,
    withdrawals:
      gap && gap.withdrawal > 0 && !gapScoped
        ? {
            amount: deflate(gap.withdrawal, yearRow.year),
            taxCost: deflate(gap.taxCost, yearRow.year),
          }
        : undefined,
    items: inOutItems.length > 0 ? inOutItems : undefined,
    growth:
      Math.abs(totalGrowth) > 1
        ? {
            amount: deflate(totalGrowth, yearRow.year),
          }
        : undefined,
    budget: budgetProfileName
      ? {
          profile: budgetProfileName,
          amount: deflate(yearRow.projectedExpenses, yearRow.year),
        }
      : undefined,
    overrideNote:
      accumOverrideNotes &&
      !accumOverrides.some(
        (o) => o.year === yearRow.year && o.contributionRate !== undefined,
      )
        ? `Changed this year: ${accumOverrideNotes}`
        : undefined,
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
                  proRatedAmount: empAmount,
                }
              : undefined;
          })()
        : undefined,
  });
}

/** One balance column's tooltip, per account. */
export function accountBalanceTooltip(
  colDisplayContribution: number,
  colDisplayGrowth: number,
  splits: ReturnType<typeof computeAccountSplits>["splits"],
  colSplitsTotal: number,
  deflate: ProjectionState["deflate"],
  yearRow: EngineAccumulationYear,
  catKey: string,
  renderTooltip: ProjectionState["renderTooltip"],
  col: { key: string; val: number; color: string; label: string },
  pct: number,
  colBoyBalance: number,
  colDeflatedBalance: number,
  colDisplayChange: number,
) {
  const colChangeParts: {
    label: string;
    amount: number;
    color: TipColor;
  }[] = [];
  if (colDisplayContribution > 0)
    colChangeParts.push({
      label: "contrib",
      amount: colDisplayContribution,
      color: "green",
    });
  if (Math.abs(colDisplayGrowth) > 1)
    colChangeParts.push({
      label: "growth",
      amount: colDisplayGrowth,
      color: colDisplayGrowth >= 0 ? "blue" : "red",
    });
  const splitItems: TooltipLineItem[] = splits.map(
    ({
      name: accountName,
      taxType: spTaxType,
      balance: spBalance,
      contribution: spContribution,
      growth: spGrowth,
    }) => {
      const entryPercent = percentOf(spBalance, colSplitsTotal);
      const subItems: TooltipLineItem[] = [];
      if (spContribution > 1)
        subItems.push({
          label: "contrib",
          amount: deflate(spContribution, yearRow.year),
          prefix: "+",
          color: "green",
        });
      if (Math.abs(spGrowth) > 1)
        subItems.push({
          label: "growth",
          amount: deflate(spGrowth, yearRow.year),
          prefix: spGrowth >= 0 ? "+" : undefined,
          color: spGrowth >= 0 ? "blue" : "red",
        });
      return {
        label: accountName,
        amount: deflate(spBalance, yearRow.year),
        percent: entryPercent,
        taxType: itemTaxType(catKey, spTaxType),
        sub: subItems.length > 0 ? subItems : undefined,
      };
    },
  );
  return renderTooltip({
    kind: "money",
    header: `${col.label}: ${pct}% of portfolio`,
    meta: `${yearRow.year} · BoY: ${formatCurrency(colBoyBalance)} → EoY: ${formatCurrency(colDeflatedBalance)} · ${formatPercent(yearRow.returnRate, 1)} return${yearRow.proRateFraction != null && yearRow.proRateFraction > 0 ? ` (${formatPercent(yearRow.annualizedReturnRate, 1)} annual)` : ""}`,
    items: splitItems,
    yearChange: {
      total: colDeflatedBalance,
      change: colDisplayChange,
      parts: colChangeParts.length > 0 ? colChangeParts : undefined,
    },
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
  });
}
