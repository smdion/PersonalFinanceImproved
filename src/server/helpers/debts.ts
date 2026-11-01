/**
 * Other liabilities (everything but the mortgage), one computation for
 * every reader — net worth, the year-end snapshot, finalizing a year, the
 * Liabilities page and milestones:
 *  - `manual`: the household's typed "other debts, not itemized" figure
 *    (app_settings current_other_liabilities);
 *  - `itemized`: open rows of the debts list (not paid off as of `asOf`);
 *  - `creditCardMapped`: credit-card balances from the budget's mapped
 *    accounts (getEffectiveCreditCardDebt).
 * Balances are as entered (never amortized forward) — or, for a debt
 * mapped to a budget account, the balance last pulled from it (written on
 * sync, like the mortgage's). Finalizing a year
 * stores today's balances, as it always has for the typed one, for the
 * debts open at that year's Dec 31.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ActiveBudgetApi } from "@/lib/budget-api/types";
import { localDateStr } from "@/lib/utils/date";
import { getEffectiveCreditCardDebt } from "./budget";
import { parseAppSettings } from "./settings";
import { toNumber } from "./transforms";
import type { DbOrTx } from "./transforms";

type OpenDebt = typeof schema.debts.$inferSelect;

type OtherLiabilities = {
  manual: number;
  itemized: number;
  creditCardMapped: number;
  total: number;
  /** Open debts (not paid off as of `asOf`). */
  openDebts: OpenDebt[];
};

/** A debt's balance now: the pulled one while a budget account feeds it,
 *  else the one entered — with the day it's from. */
export function debtBalance(d: {
  balance: string;
  balanceAsOf: string;
  apiBalance: string | null;
  apiBalanceDate: string | null;
}): { balance: number; asOf: string; pulled: boolean } {
  return d.apiBalance != null
    ? {
        balance: toNumber(d.apiBalance),
        asOf: d.apiBalanceDate ?? d.balanceAsOf,
        pulled: true,
      }
    : { balance: toNumber(d.balance), asOf: d.balanceAsOf, pulled: false };
}

/** Is a debt still owed on `asOfDate` (YYYY-MM-DD)? Paid off by its date,
 *  or — fed by a budget account — once the pulled balance reaches zero. */
export function isOpenDebt(
  d: { paidOffDate: string | null; apiBalance?: string | null },
  asOfDate: string,
): boolean {
  if (d.apiBalance != null && toNumber(d.apiBalance) <= 0) return false;
  return d.paidOffDate == null || d.paidOffDate > asOfDate;
}

export async function getEffectiveOtherLiabilities(
  db: DbOrTx,
  {
    activeBudgetApi,
    asOf = new Date(),
  }: { activeBudgetApi?: ActiveBudgetApi; asOf?: Date } = {},
): Promise<OtherLiabilities> {
  const [manualRow] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "current_other_liabilities"));
  const manual = parseAppSettings(manualRow ? [manualRow] : [])(
    "current_other_liabilities",
    0,
  );
  const day = localDateStr(asOf);
  const openDebts = (await db.select().from(schema.debts)).filter((d) =>
    isOpenDebt(d, day),
  );
  const itemized = openDebts.reduce((s, d) => s + debtBalance(d).balance, 0);
  const creditCardMapped = await getEffectiveCreditCardDebt(
    db as Parameters<typeof getEffectiveCreditCardDebt>[0],
    activeBudgetApi,
  );
  return {
    manual,
    itemized,
    creditCardMapped,
    total: manual + itemized + creditCardMapped,
    openDebts,
  };
}
