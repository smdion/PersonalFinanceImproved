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
import { catDisplayLabel, itemTaxType } from "./utils";
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
