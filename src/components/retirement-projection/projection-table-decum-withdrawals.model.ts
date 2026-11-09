/** The decumulation row's withdrawal columns: each category's and each
 *  tax type's tooltip. */
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  DecumulationSlot,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionState } from "./projection-table-types";
import type { TipColor } from "./types";
import {
  catDisplayLabel,
  formatDiscretionaryTierBreakdown,
} from "./projection-display";
import {
  lumpSumTotal,
  lumpSumsForBucket,
  lumpSumsForCategory,
} from "./lump-sums";
import { itemTaxType } from "./projection-columns";
import { bucketSlotMap } from "./bucket-slots";
import {
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  isOverflowTarget,
  isQcdEligible,
  nonMedicalPenaltyRate,
} from "@/lib/config/account-types";
import { categoryWithdrawalItems } from "./projection-table-decum-row.model";
import { ownerAccountLabel } from "./account-notes";
import { taxTypeLabel } from "@/lib/utils/colors";

/** One account category's withdrawal tooltip: draws, lump sums, RMD excess, QCD. */
export function categoryWithdrawalTooltip(
  dSlotMap: Map<AccountCategory, DecumulationSlot>,
  cat: AccountCategory,
  withdrawal: number,
  categoryAccounts: NonNullable<
    EngineDecumulationYear["individualAccountBalances"]
  >,
  yearRow: EngineDecumulationYear,
  deflate: ProjectionState["deflate"],
  noteFor: (ia: IndividualAccountYearBalance) => {
    note?: string;
    noteLocked?: boolean;
  },
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  engineSettings: ProjectionState["engineSettings"],
  renderTooltip: ProjectionState["renderTooltip"],
  catGrowth: number,
  catBalance: number,
) {
  const dSlot = dSlotMap.get(cat);
  const catCfg = getAccountTypeConfig(cat);
  const items = categoryWithdrawalItems(
    withdrawal,
    categoryAccounts,
    catCfg,
    dSlot,
    yearRow,
    deflate,
    noteFor,
  );
  // Add lump sum items for this category
  const catLumps = lumpSumsForCategory(yearLumpSums, cat);
  for (const ls of catLumps) {
    items.push({
      label: ls.label ?? "Lump sum",
      amount: deflate(ls.amount, yearRow.year),
      prefix: "+",
      color: "emerald",
    });
  }
  // RMD-forced excess beyond the spending need. Under "reinvest" (default) it
  // credits the overflow target (brokerage) as a "+" line; under "spend" no
  // account is credited, so it shows as an informational note.
  const rmdExcess = yearRow.rmdExcessAmount ?? 0;
  const rmdMode = engineSettings?.rmdExcessHandling;
  if (rmdExcess > 0.01 && isOverflowTarget(cat)) {
    if (rmdMode === "spend") {
      items.push({
        label: "RMD excess spent (not reinvested)",
        amount: deflate(rmdExcess, yearRow.year),
        color: "gray",
      });
    } else {
      items.push({
        label: "RMD excess reinvested",
        amount: deflate(rmdExcess, yearRow.year),
        prefix: "+",
        color: "amber",
      });
    }
  }
  // QCD: money sent from this account to charity, part of
  // the RMD but not taxable income. Deducted before routing
  // runs, so no slot line shows it; `qcdEligible` types only (by law).
  const qcdAmount = yearRow.qcdAmount ?? 0;
  if (qcdAmount > 0.01 && isQcdEligible(cat)) {
    items.push({
      label: "QCD to charity (excluded from taxable income)",
      amount: deflate(qcdAmount, yearRow.year),
      prefix: "-",
      color: "violet",
    });
  }
  const catLumpTotal = lumpSumTotal(catLumps);
  // "Why was this account used": only the discretionary-tier source kinds
  // (roth/brokerage/hsa) that apply to THIS category, not the whole
  // household's breakdown.
  const catSourceKinds = new Set<"roth" | "brokerage" | "hsa">();
  if (catCfg.isOverflowTarget) catSourceKinds.add("brokerage");
  if (nonMedicalPenaltyRate(cat) !== null) catSourceKinds.add("hsa");
  if (catCfg.supportsRothSplit && (dSlot?.rothWithdrawal ?? 0) > 0.01)
    catSourceKinds.add("roth");
  const catTierBreakdown = yearRow.discretionaryTierBreakdown?.filter((t) =>
    catSourceKinds.has(t.source),
  );
  return renderTooltip({
    kind: "money",
    header: `${catDisplayLabel[cat] ?? cat}${catLumpTotal > 0 || rmdExcess > 0.01 || qcdAmount > 0.01 ? " Activity" : " Withdrawals"}`,
    items: items.length > 0 ? items : undefined,
    withdrawals:
      withdrawal > 0 && items.length === 0
        ? {
            amount: deflate(withdrawal, yearRow.year),
          }
        : undefined,
    growth:
      Math.abs(catGrowth) > 1
        ? {
            amount: deflate(catGrowth, yearRow.year),
          }
        : undefined,
    routingNote: formatDiscretionaryTierBreakdown(
      catTierBreakdown?.map((t) => ({
        ...t,
        amount: deflate(t.amount, yearRow.year),
      })),
    ),
    balance: deflate(catBalance, yearRow.year),
  });
}

/** One tax type's withdrawal tooltip, per account drawn from. */
export function taxTypeWithdrawalTooltip(
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  withdrawingAccounts: NonNullable<
    EngineDecumulationYear["individualAccountBalances"]
  >,
  deflate: ProjectionState["deflate"],
  yearRow: EngineDecumulationYear,
  noteFor: (ia: IndividualAccountYearBalance) => {
    note?: string;
    noteLocked?: boolean;
  },
  parts: { cat: string; withdrawal: number }[],
  renderTooltip: ProjectionState["renderTooltip"],
  bucketWithdrawal: number,
) {
  const taxPrefCat = categoriesWithTaxPreference()[0]!;
  const withdrawalTaxType = bucketSlotMap[bucket]?.taxField
    ? itemTaxType(taxPrefCat, bucketSlotMap[bucket]!.taxField)
    : undefined;
  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
  const multiAccount = withdrawingAccounts.length > 1;
  const allItems = [
    ...(withdrawingAccounts.length > 0
      ? withdrawingAccounts.map((ia) => ({
          label: multiAccount
            ? ownerAccountLabel(ia)
            : (catDisplayLabel[ia.category] ?? ia.category),
          amount: deflate(ia.draw!.withdrawal, yearRow.year),
          prefix: "-" as const,
          taxType: itemTaxType(ia.category, withdrawalTaxType),
          color: "red" as TipColor,
          ...noteFor(ia),
        }))
      : parts.map((p) => ({
          label: catDisplayLabel[p.cat] ?? p.cat,
          amount: deflate(p.withdrawal, yearRow.year),
          prefix: "-" as const,
          taxType: itemTaxType(p.cat, withdrawalTaxType),
          color: "red" as TipColor,
        }))),
    ...bucketLumps.map((ls) => ({
      label: ls.label ?? "Lump sum",
      amount: deflate(ls.amount, yearRow.year),
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
            amount: deflate(bucketLumpTotal - bucketWithdrawal, yearRow.year),
            prefix: bucketLumpTotal >= bucketWithdrawal ? "+" : "-",
          }
        : undefined,
  });
}

/** One tax type's tooltip when only lump sums land in it. */
export function taxTypeLumpSumTooltip(
  yearLumpSums: EngineDecumulationYear["config"]["lumpSums"],
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  renderTooltip: ProjectionState["renderTooltip"],
  deflate: ProjectionState["deflate"],
  yearRow: EngineDecumulationYear,
) {
  const bucketLumps = lumpSumsForBucket(yearLumpSums, bucket);
  if (bucketLumps.length === 0) return undefined;
  return renderTooltip({
    kind: "money",
    header: `${taxTypeLabel(bucket)} Lump Sum`,
    items: bucketLumps.map((ls) => ({
      label: ls.label ?? "Lump sum",
      amount: deflate(ls.amount, yearRow.year),
      prefix: "+" as const,
      color: "emerald" as TipColor,
    })),
  });
}
