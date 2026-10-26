/**
 * Other liabilities (everything but the mortgage), one computation for
 * every reader — net worth, the year-end snapshot, finalizing a year, the
 * Liabilities page and milestones:
 *  - `manual`: the household's typed "other debts, not itemized" figure
 *    (app_settings current_other_liabilities);
 *  - `itemized`: open rows of the debts list (not paid off as of `asOf`);
 *  - `creditCardMapped`: credit-card balances from the budget's mapped
 *    accounts (getEffectiveCreditCardDebt).
 * Balances are as entered (never amortized forward). Finalizing a year
 * stores today's figures, as it always has for the typed one.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ActiveBudgetApi } from "@/lib/budget-api/types";
import { localDateStr } from "@/lib/utils/date";
import { getEffectiveCreditCardDebt } from "./budget";
import { toNumber } from "./transforms";
import type { DbOrTx } from "./transforms";

export type OpenDebt = typeof schema.debts.$inferSelect;

export type OtherLiabilities = {
  manual: number;
  itemized: number;
  creditCardMapped: number;
  total: number;
  /** Open debts (not paid off as of `asOf`). */
  openDebts: OpenDebt[];
};

/** Is a debt still owed on `asOfDate` (YYYY-MM-DD)? */
export function isOpenDebt(
  d: { paidOffDate: string | null },
  asOfDate: string,
): boolean {
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
  const manual = Number(manualRow?.value ?? 0) || 0;
  const day = localDateStr(asOf);
  const openDebts = (await db.select().from(schema.debts)).filter((d) =>
    isOpenDebt(d, day),
  );
  const itemized = openDebts.reduce((s, d) => s + toNumber(d.balance), 0);
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
