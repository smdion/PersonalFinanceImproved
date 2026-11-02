/**
 * A SimpleFIN feed as a mortgage's balance. It writes the same
 * mortgage_loans.api_balance a budget pull does, so every reader follows
 * through computeMortgageBalance; while a feed is included, budget pulls
 * leave that loan alone.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { localDateStr } from "@/lib/utils/date";
import type { DbOrTx } from "./transforms";

/** Loans whose balance comes from an included feed. */
export async function loansFedBySimplefin(db: DbOrTx): Promise<Set<number>> {
  const rows = await db
    .select({ loanId: schema.simplefinAccounts.linkedLoanId })
    .from(schema.simplefinAccounts)
    .where(
      and(
        isNotNull(schema.simplefinAccounts.linkedLoanId),
        eq(schema.simplefinAccounts.isIncluded, true),
      ),
    );
  return new Set(rows.map((r) => r.loanId!));
}

/** Writes each included loan feed's balance to its loan. `onlyExternalIds`:
 *  a sync passes what it really received, so a feed that errored or didn't
 *  answer can't erase a liability. */
export async function applyLoanFeedBalances(
  db: DbOrTx,
  onlyExternalIds?: ReadonlySet<string>,
): Promise<void> {
  const feeds = await db
    .select()
    .from(schema.simplefinAccounts)
    .where(
      and(
        isNotNull(schema.simplefinAccounts.linkedLoanId),
        eq(schema.simplefinAccounts.isIncluded, true),
      ),
    );
  for (const feed of feeds) {
    if (onlyExternalIds && !onlyExternalIds.has(feed.externalAccountId))
      continue;
    await db
      .update(schema.mortgageLoans)
      .set({
        apiBalance: String(Math.abs(Number(feed.lastBalance))),
        apiBalanceDate: localDateStr(feed.lastBalanceDate ?? feed.lastSeenAt),
      })
      .where(eq(schema.mortgageLoans.id, feed.linkedLoanId!));
  }
}

/** A feed stopped reporting this loan: back to its schedule, until the next
 *  budget pull (if one is mapped) fills it in under the right label. */
export async function clearLoanBalance(
  db: DbOrTx,
  loanId: number,
): Promise<void> {
  await db
    .update(schema.mortgageLoans)
    .set({ apiBalance: null, apiBalanceDate: null })
    .where(eq(schema.mortgageLoans.id, loanId));
}
