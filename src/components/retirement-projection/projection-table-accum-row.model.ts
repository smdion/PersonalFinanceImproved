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
import { catDisplayLabel } from "./projection-display";
import { itemTaxType, proRateMonths } from "./projection-columns";
import { safeDivide } from "@/lib/utils/math";
import {
  PERF_CATEGORY_RETIREMENT,
  taxTypeLabel,
} from "@/lib/config/display-labels";
import { annualRaiseLabel } from "@/lib/pure/household/raise-rates";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { buildEligibilityNote, ownerAccountLabel } from "./account-notes";

type AccountBalances = NonNullable<
  EngineAccumulationYear["individualAccountBalances"]
>;

/** The contribution total's tax-type lines: the household's buckets, or
 *  the filtered person's own accounts by tax type. */
export function contributionTaxTypeTotals(
  yearRow: EngineAccumulationYear,
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
    if (yearRow.totalTraditional > 0)
      bucketTotals.push({
        label: taxTypeLabel("preTax"),
        amount: deflate(yearRow.totalTraditional, yearRow.year),
        color: "blue",
      });
    if (yearRow.totalRoth > 0)
      bucketTotals.push({
        label: taxTypeLabel("taxFree"),
        amount: deflate(yearRow.totalRoth, yearRow.year),
        color: "violet",
      });
    // Single-bucket categories (HSA, brokerage, etc.)
    for (const sbCat of getAllCategories().filter(
      (c) => !ACCOUNT_TYPE_CONFIG[c].supportsRothSplit,
    )) {
      const isOF = isOverflowTarget(sbCat);
      const sbSlot = yearRow.slots.find((s) => s.category === sbCat);
      if (sbSlot && sbSlot.employeeContrib > 0) {
        bucketTotals.push({
          label: getAccountTypeConfig(sbCat).displayLabel,
          amount: deflate(sbSlot.employeeContrib, yearRow.year),
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
        amount: deflate(ptTrad, yearRow.year),
        color: "blue",
      });
    if (ptRoth > 0)
      bucketTotals.push({
        label: taxTypeLabel("taxFree"),
        amount: deflate(ptRoth, yearRow.year),
        color: "violet",
      });
    Array.from(ptSingleBucket.entries()).forEach(
      ([sbCat, singleBucketAmount]) => {
        if (singleBucketAmount > 0) {
          const cfg = getAccountTypeConfig(sbCat as AccountCategory);
          bucketTotals.push({
            label: cfg.displayLabel,
            amount: deflate(singleBucketAmount, yearRow.year),
            color: cfg.isOverflowTarget ? "amber" : "emerald",
          });
        }
      },
    );
    return bucketTotals;
  }
}

/** Each account drawn from in a gap year, as a retirement year lists them:
 *  owner, tax type, and whether the money is penalty-free. */
export function gapDrawnItems(
  yearRow: EngineAccumulationYear,
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
      amount: deflate(ia.draw!.withdrawal, yearRow.year),
      prefix: "-",
      taxType: itemTaxType(ia.category, ia.taxType),
      color: "red",
      group: `Withdrawn · ${catDisplayLabel[ia.category] ?? ia.category}`,
      ...buildEligibilityNote(ia, yearRow, deflate),
    });
  return items;
}

/** Each person's age in this year. */
export function yearAgesTooltip(
  people: { id: number; name: string; birthYear: number }[] | undefined,
  enginePeople: ProjectionState["enginePeople"],
  renderTooltip: ProjectionState["renderTooltip"],
  yearRow: EngineAccumulationYear,
) {
  const pp = people ?? enginePeople;
  if (!pp || pp.length === 0) return undefined;
  return renderTooltip({
    kind: "info",
    lines: pp.map((p) => ({
      text: `${p.name}: ${yearRow.year - p.birthYear}`,
      style: "header" as const,
    })),
  });
}

/** The salary cell's tooltip: the change from last year, the raise and each person's salary. */
export function salaryTooltip(
  result: NonNullable<ProjectionState["result"]>,
  yearRow: EngineAccumulationYear,
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
  const previousYear = result.projectionByYear.find(
    (y) => y.year === yearRow.year - 1,
  );
  // Use person-filtered salary if applicable
  const personId =
    isPersonFiltered && enginePeople?.find((p) => p.id === personFilter)?.id;
  const currentSalary = personId
    ? (yearRow.projectedSalaryByPerson?.[personId] ?? yearRow.projectedSalary)
    : yearRow.projectedSalary;
  const prevSalary =
    previousYear && previousYear.phase === "accumulation"
      ? personId
        ? ((previousYear as EngineAccumulationYear).projectedSalaryByPerson?.[
            personId
          ] ?? (previousYear as EngineAccumulationYear).projectedSalary)
        : (previousYear as EngineAccumulationYear).projectedSalary
      : null;
  const percentChange =
    prevSalary && prevSalary > 0
      ? (currentSalary - prevSalary) / prevSalary
      : null;
  const lines: {
    text: string;
    style: "header" | "meta" | "note";
    color?: TipColor;
  }[] = [];
  if (yearRow.hasSalaryOverride) {
    lines.push({
      text: `Salary changed for this year${salaryOverrideNotes ? ` — ${salaryOverrideNotes}` : ""}`,
      style: "note",
      color: "emerald",
    });
  } else if (percentChange !== null) {
    lines.push({
      text: `${percentChange >= 0 ? "+" : ""}${formatPercent(percentChange, 1)} from prior year`,
      style: "header",
    });
  } else {
    lines.push({
      text: "Base salary (year 1)",
      style: "header",
    });
  }
  if (!yearRow.hasSalaryOverride && engineSettings) {
    lines.push({
      text: `Annual raise: ${annualRaiseLabel(Number(engineSettings.salaryAnnualIncrease), enginePerPersonSettings)}/yr`,
      style: "meta",
    });
  }
  if (!personId && yearRow.projectedSalaryByPerson) {
    const pp = people ?? enginePeople;
    const breakdown = (pp ?? [])
      .filter((p) => yearRow.projectedSalaryByPerson?.[p.id])
      .map((p) => ({
        name: p.name,
        salary: yearRow.projectedSalaryByPerson![p.id]!,
      }));
    if (breakdown.length >= 2) {
      lines.push(
        ...breakdown.map((b) => ({
          text: `${b.name}: ${formatCurrency(deflate(b.salary, yearRow.year))}`,
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
  yearRow: EngineAccumulationYear,
  isPersonFiltered: ProjectionState["isPersonFiltered"],
  enginePeople: ProjectionState["enginePeople"],
  personFilter: ProjectionState["personFilter"],
  deflate: ProjectionState["deflate"],
) {
  let displaySalary = yearRow.projectedSalary;
  if (isPersonFiltered && yearRow.projectedSalaryByPerson && enginePeople) {
    const person = enginePeople.find((p) => p.id === personFilter);
    if (person && yearRow.projectedSalaryByPerson[person.id] != null) {
      displaySalary = yearRow.projectedSalaryByPerson[person.id]!;
    }
  }
  return formatCurrency(deflate(displaySalary, yearRow.year));
}

/** The savings-rate cell's tooltip: the rate's math, the target and the ceiling. */
export function savingsRateTooltip(
  yearRow: EngineAccumulationYear,
  rateIncludesMatch: boolean,
  deflate: ProjectionState["deflate"],
  parentCategoryFilter: string | undefined,
  accumOverrides: ProjectionState["accumOverrides"],
  accumOverrideNotes: string | undefined,
  renderTooltip: ProjectionState["renderTooltip"],
) {
  const effectiveSalary =
    yearRow.proRateFraction != null && yearRow.proRateFraction > 0
      ? yearRow.projectedSalary * yearRow.proRateFraction
      : yearRow.projectedSalary;
  // The accounts this page shows (the year is already scoped),
  // with the match when the shared switch counts it.
  const rateAmount =
    yearRow.totalEmployee + (rateIncludesMatch ? yearRow.totalEmployer : 0);
  const effectiveRate = safeDivide(rateAmount, effectiveSalary);
  const employeeRate = safeDivide(yearRow.totalEmployee, effectiveSalary);
  const lines: {
    text: string;
    style: "header" | "meta" | "note";
    color?: TipColor;
  }[] = [
    {
      text: `${formatCurrency(deflate(rateAmount, yearRow.year))} / ${formatCurrency(deflate(effectiveSalary, yearRow.year))} = ${formatPercent(effectiveRate, 1)}${rateIncludesMatch ? " (incl. match)" : ""}${parentCategoryFilter ? ` — ${parentCategoryFilter} accounts` : ""}`,
      style: "header",
    },
    {
      text: `Retirement target (retirement accounts, your money): ${formatPercent(yearRow.config.contributionRate, 1)}`,
      style: "meta",
    },
  ];
  if (yearRow.proRateFraction != null) {
    lines.push({
      text: `${proRateMonths(yearRow.proRateFraction)}/12 mo — salary pro-rated from ${formatCurrency(deflate(yearRow.projectedSalary, yearRow.year))}/yr`,
      style: "meta",
    });
  }
  // The ceiling scales retirement contributions only, so the
  // uncapped figure is meaningful on the Retirement view.
  if (
    yearRow.rateCeilingScale != null &&
    yearRow.rateCeilingScale < 1 &&
    yearRow.rateCeilingScale > 0 &&
    parentCategoryFilter === PERF_CATEGORY_RETIREMENT
  ) {
    lines.push({
      text: `Uncapped rate: ${formatPercent(safeDivide(yearRow.totalEmployee, effectiveSalary * yearRow.rateCeilingScale), 1)} → ${formatPercent(employeeRate, 1)} (ceiling applied)`,
      style: "note",
      color: "amber",
    });
  }
  // Comparable with the retirement target only when it's the
  // same measure: retirement accounts, your money only.
  if (
    yearRow.rateCeilingScale == null &&
    parentCategoryFilter === PERF_CATEGORY_RETIREMENT
  ) {
    const diff = employeeRate - yearRow.config.contributionRate;
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
      (o) => o.year === yearRow.year && o.contributionRate !== undefined,
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
