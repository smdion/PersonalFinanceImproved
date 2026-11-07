/** The accumulation row's view model: what its cells and tooltips show,
 *  computed from the engine's year with the page's formatters. */
import type { EngineAccumulationYear } from "@/lib/pure/engine/types";
import type { TipColor, TooltipLineItem } from "./types";
import type { ProjectionState } from "./projection-table-types";
import {
  getAllCategories,
  getAccountTypeConfig,
  ACCOUNT_TYPE_CONFIG,
  isPreTaxType,
  isTaxFreeBucket,
  isOverflowTarget,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { taxTypeLabel } from "@/lib/utils/colors";
import {
  catDisplayLabel,
  itemTaxType,
  proRateMonths,
  safeDivide,
} from "./utils";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import { annualRaiseLabel } from "@/lib/pure/household/raise-rates";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { buildEligibilityNote, ownerAccountLabel } from "./account-notes";

type AccountBalances = NonNullable<
  EngineAccumulationYear["individualAccountBalances"]
>;

/** The contribution total's tax-type lines: the household's buckets, or
 *  the filtered person's own accounts by tax type. */
export function contributionTaxTypeTotals(
  yr: EngineAccumulationYear,
  pt: ReturnType<ProjectionState["getPersonYearTotals"]>,
  mine: AccountBalances,
  deflate: ProjectionState["deflate"],
): { label: string; amount: number; color: TipColor }[] {
  if (!pt) {
    const bucketTotals: {
      label: string;
      amount: number;
      color: TipColor;
    }[] = [];
    if (yr.totalTraditional > 0)
      bucketTotals.push({
        label: taxTypeLabel("preTax"),
        amount: deflate(yr.totalTraditional, yr.year),
        color: "blue",
      });
    if (yr.totalRoth > 0)
      bucketTotals.push({
        label: taxTypeLabel("taxFree"),
        amount: deflate(yr.totalRoth, yr.year),
        color: "violet",
      });
    // Single-bucket categories (HSA, brokerage, etc.)
    for (const sbCat of getAllCategories().filter(
      (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
    )) {
      const isOF = isOverflowTarget(sbCat);
      const sbSlot = yr.slots.find((s) => s.category === sbCat);
      if (sbSlot && sbSlot.employeeContrib > 0) {
        bucketTotals.push({
          label: getAccountTypeConfig(sbCat).displayLabel,
          amount: deflate(sbSlot.employeeContrib, yr.year),
          color: isOF ? "amber" : "emerald",
        });
      }
    }
    return bucketTotals;
  } else {
    // Person-filtered: build tax-type breakdown from individual accounts
    const bucketTotals: {
      label: string;
      amount: number;
      color: TipColor;
    }[] = [];
    let ptTrad = 0,
      ptRoth = 0;
    const ptSingleBucket = new Map<string, number>();
    for (const ia of mine) {
      const cfg = ACCOUNT_TYPE_CONFIG[ia.category];
      if (cfg?.supportsRothSplit) {
        if (isPreTaxType(ia.taxType)) ptTrad += ia.contribution;
        else ptRoth += ia.contribution;
      } else {
        ptSingleBucket.set(
          ia.category,
          (ptSingleBucket.get(ia.category) ?? 0) + ia.contribution,
        );
      }
    }
    if (ptTrad > 0)
      bucketTotals.push({
        label: taxTypeLabel("preTax"),
        amount: deflate(ptTrad, yr.year),
        color: "blue",
      });
    if (ptRoth > 0)
      bucketTotals.push({
        label: taxTypeLabel("taxFree"),
        amount: deflate(ptRoth, yr.year),
        color: "violet",
      });
    Array.from(ptSingleBucket.entries()).forEach(([sbCat, sbAmt]) => {
      if (sbAmt > 0) {
        const cfg = getAccountTypeConfig(sbCat as AccountCategory);
        bucketTotals.push({
          label: cfg.displayLabel,
          amount: deflate(sbAmt, yr.year),
          color: cfg.isOverflowTarget ? "amber" : "emerald",
        });
      }
    });
    return bucketTotals;
  }
}

/** Each account drawn from in a gap year, as a retirement year lists them:
 *  owner, tax type, and whether the money is penalty-free. */
export function gapDrawnItems(
  yr: EngineAccumulationYear,
  shown: AccountBalances,
  deflate: ProjectionState["deflate"],
): TooltipLineItem[] {
  const items: TooltipLineItem[] = [];
  const categoryOrder = getAllCategories();
  const drawn = shown
    .filter((ia) => (ia.draw?.withdrawal ?? 0) > 0)
    .sort(
      (a, b) =>
        categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) ||
        (isTaxFreeBucket(a.taxType) ? 1 : 0) -
          (isTaxFreeBucket(b.taxType) ? 1 : 0) ||
        (a.ownerName ?? a.name).localeCompare(b.ownerName ?? b.name),
    );
  for (const ia of drawn)
    items.push({
      label: ownerAccountLabel(ia),
      amount: deflate(ia.draw!.withdrawal, yr.year),
      prefix: "-",
      taxType: itemTaxType(ia.category, ia.taxType),
      color: "red",
      group: `Withdrawn · ${catDisplayLabel[ia.category] ?? ia.category}`,
      ...buildEligibilityNote(ia, yr, deflate),
    });
  return items;
}

/** Each person's age in this year. */
export function yearAgesTooltip(
  people: { id: number; name: string; birthYear: number }[] | undefined,
  enginePeople: ProjectionState["enginePeople"],
  renderTooltip: ProjectionState["renderTooltip"],
  yr: EngineAccumulationYear,
) {
  const pp = people ?? enginePeople;
  if (!pp || pp.length === 0) return undefined;
  return renderTooltip({
    kind: "info",
    lines: pp.map((p) => ({
      text: `${p.name}: ${yr.year - p.birthYear}`,
      style: "header" as const,
    })),
  });
}

/** The salary cell's tooltip: the change from last year, the raise and each person's salary. */
export function salaryTooltip(
  result: NonNullable<ProjectionState["result"]>,
  yr: EngineAccumulationYear,
  isPersonFiltered: ProjectionState["isPersonFiltered"],
  enginePeople: ProjectionState["enginePeople"],
  personFilter: ProjectionState["personFilter"],
  salaryOverrideNotes: string | null | undefined,
  engineSettings: ProjectionState["engineSettings"],
  enginePerPersonSettings: ProjectionState["enginePerPersonSettings"],
  people: { id: number; name: string; birthYear: number }[] | undefined,
  deflate: ProjectionState["deflate"],
  renderTooltip: ProjectionState["renderTooltip"],
) {
  const prevYr = result.projectionByYear.find((y) => y.year === yr.year - 1);
  // Use person-filtered salary if applicable
  const personId =
    isPersonFiltered && enginePeople?.find((p) => p.id === personFilter)?.id;
  const currentSal = personId
    ? (yr.projectedSalaryByPerson?.[personId] ?? yr.projectedSalary)
    : yr.projectedSalary;
  const prevSalary =
    prevYr && prevYr.phase === "accumulation"
      ? personId
        ? ((prevYr as EngineAccumulationYear).projectedSalaryByPerson?.[
            personId
          ] ?? (prevYr as EngineAccumulationYear).projectedSalary)
        : (prevYr as EngineAccumulationYear).projectedSalary
      : null;
  const pctChange =
    prevSalary && prevSalary > 0
      ? (currentSal - prevSalary) / prevSalary
      : null;
  const lines: {
    text: string;
    style: "header" | "meta" | "note";
    color?: TipColor;
  }[] = [];
  if (yr.hasSalaryOverride) {
    lines.push({
      text: `Salary changed for this year${salaryOverrideNotes ? ` — ${salaryOverrideNotes}` : ""}`,
      style: "note",
      color: "emerald",
    });
  } else if (pctChange !== null) {
    lines.push({
      text: `${pctChange >= 0 ? "+" : ""}${formatPercent(pctChange, 1)} from prior year`,
      style: "header",
    });
  } else {
    lines.push({
      text: "Base salary (year 1)",
      style: "header",
    });
  }
  if (!yr.hasSalaryOverride && engineSettings) {
    lines.push({
      text: `Annual raise: ${annualRaiseLabel(Number(engineSettings.salaryAnnualIncrease), enginePerPersonSettings)}/yr`,
      style: "meta",
    });
  }
  if (!personId && yr.projectedSalaryByPerson) {
    const pp = people ?? enginePeople;
    const breakdown = (pp ?? [])
      .filter((p) => yr.projectedSalaryByPerson?.[p.id])
      .map((p) => ({
        name: p.name,
        salary: yr.projectedSalaryByPerson![p.id]!,
      }));
    if (breakdown.length >= 2) {
      lines.push(
        ...breakdown.map((b) => ({
          text: `${b.name}: ${formatCurrency(deflate(b.salary, yr.year))}`,
          style: "meta" as const,
        })),
      );
    }
  }
  return renderTooltip({
    kind: "info",
    lines,
  });
}

/** The salary cell: the filtered person's salary when one is shown. */
export function displaySalary(
  yr: EngineAccumulationYear,
  isPersonFiltered: ProjectionState["isPersonFiltered"],
  enginePeople: ProjectionState["enginePeople"],
  personFilter: ProjectionState["personFilter"],
  deflate: ProjectionState["deflate"],
) {
  let displaySalary = yr.projectedSalary;
  if (isPersonFiltered && yr.projectedSalaryByPerson && enginePeople) {
    const person = enginePeople.find((p) => p.id === personFilter);
    if (person && yr.projectedSalaryByPerson[person.id] != null) {
      displaySalary = yr.projectedSalaryByPerson[person.id]!;
    }
  }
  return formatCurrency(deflate(displaySalary, yr.year));
}

/** The savings-rate cell's tooltip: the rate's math, the target and the ceiling. */
export function savingsRateTooltip(
  yr: EngineAccumulationYear,
  rateIncludesMatch: boolean,
  deflate: ProjectionState["deflate"],
  parentCategoryFilter: string | undefined,
  accumOverrides: ProjectionState["accumOverrides"],
  accumOverrideNotes: string | undefined,
  renderTooltip: ProjectionState["renderTooltip"],
) {
  const effectiveSalary =
    yr.proRateFraction != null && yr.proRateFraction > 0
      ? yr.projectedSalary * yr.proRateFraction
      : yr.projectedSalary;
  // The accounts this page shows (the year is already scoped),
  // with the match when the shared switch counts it.
  const rateAmount =
    yr.totalEmployee + (rateIncludesMatch ? yr.totalEmployer : 0);
  const effectiveRate = safeDivide(rateAmount, effectiveSalary);
  const employeeRate = safeDivide(yr.totalEmployee, effectiveSalary);
  const lines: {
    text: string;
    style: "header" | "meta" | "note";
    color?: TipColor;
  }[] = [
    {
      text: `${formatCurrency(deflate(rateAmount, yr.year))} / ${formatCurrency(deflate(effectiveSalary, yr.year))} = ${formatPercent(effectiveRate, 1)}${rateIncludesMatch ? " (incl. match)" : ""}${parentCategoryFilter ? ` — ${parentCategoryFilter} accounts` : ""}`,
      style: "header",
    },
    {
      text: `Retirement target (retirement accounts, your money): ${formatPercent(yr.config.contributionRate, 1)}`,
      style: "meta",
    },
  ];
  if (yr.proRateFraction != null) {
    lines.push({
      text: `${proRateMonths(yr.proRateFraction)}/12 mo — salary pro-rated from ${formatCurrency(deflate(yr.projectedSalary, yr.year))}/yr`,
      style: "meta",
    });
  }
  // The ceiling scales retirement contributions only, so the
  // uncapped figure is meaningful on the Retirement view.
  if (
    yr.rateCeilingScale != null &&
    yr.rateCeilingScale < 1 &&
    yr.rateCeilingScale > 0 &&
    parentCategoryFilter === PERF_CATEGORY_RETIREMENT
  ) {
    lines.push({
      text: `Uncapped rate: ${formatPercent(safeDivide(yr.totalEmployee, effectiveSalary * yr.rateCeilingScale), 1)} → ${formatPercent(employeeRate, 1)} (ceiling applied)`,
      style: "note",
      color: "amber",
    });
  }
  // Comparable with the retirement target only when it's the
  // same measure: retirement accounts, your money only.
  if (
    yr.rateCeilingScale == null &&
    parentCategoryFilter === PERF_CATEGORY_RETIREMENT
  ) {
    const diff = employeeRate - yr.config.contributionRate;
    if (Math.abs(diff) > 0.001) {
      lines.push({
        text: `Actual ${diff > 0 ? "higher" : "lower"} — per-account specs${diff < 0 ? " / IRS limits" : ""}`,
        style: "note",
        color: "amber",
      });
    }
  }
  if (
    accumOverrides.some(
      (o) => o.year === yr.year && o.contributionRate !== undefined,
    )
  ) {
    lines.push({
      text: `Changed for this year${accumOverrideNotes ? ` — ${accumOverrideNotes}` : ""}`,
      style: "note",
      color: "emerald",
    });
  }
  return renderTooltip({
    kind: "info",
    lines,
  });
}
