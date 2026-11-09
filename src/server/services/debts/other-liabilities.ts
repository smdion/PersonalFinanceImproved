/**
 * Other liabilities (all but the mortgage) for every reader: `manual` typed figure, `itemized`
 * debts-list rows open as of `asOf`, `creditCardMapped` budget credit-card balances.
 * Balances are as entered, or as last pulled for a debt mapped to a budget account.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ActiveBudgetApi } from "@/lib/budget-api/types";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { getEffectiveCreditCardDebt } from "@/server/services/budget/account-balances";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import type { DbOrTx } from "@/lib/db";
import { isOpenDebt, debtBalance } from "@/lib/pure/debts/debt-balance";

type OpenDebt = typeof schema.debts.$inferSelect;

type OtherLiabilities = {
  manual: number;
  itemized: number;
  creditCardMapped: number;
  total: number;
  /** Open debts (not paid off as of `asOf`). */
  openDebts: OpenDebt[];
};

export async function getEffectiveOtherLiabilities(
  db: DbOrTx,
  { activeBudgetApi, asOf }: { activeBudgetApi?: ActiveBudgetApi; asOf: Date },
): Promise<OtherLiabilities> {
  const [manualRow] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "current_other_liabilities"));
  const manual = parseAppSettings(manualRow ? [manualRow] : [])(
    "current_other_liabilities",
    0,
  );
  const day = calendarDateOf(asOf);
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
