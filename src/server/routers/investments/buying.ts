/** Always Be Buying, month by month: whether SimpleFIN saw a deposit into
 *  a counted feed each whole month it covered (lib/pure/always-buying.ts). */
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import { localDateStr } from "@/lib/utils/date";
import { buyingMonths } from "@/lib/pure/always-buying";
import {
  loadAccounts,
  loadBalanceHistory,
  loadClassifiedTransactions,
} from "./_shared";

export const investmentBuyingRouter = createTRPCRouter({
  getBuyingMonths: portfolioProcedure.query(async ({ ctx }) => {
    const [accounts, balances, rows] = await Promise.all([
      loadAccounts(ctx.db),
      loadBalanceHistory(ctx.db),
      loadClassifiedTransactions(ctx.db, {}),
    ]);
    // Counted feeds only: linked to a tracked account and included.
    const counted = new Set(
      [...accounts.values()]
        .filter((a) => a.performanceAccountId !== null)
        .map((a) => a.id),
    );
    const posted = rows.filter(
      (r) => counted.has(r.simplefinAccountId) && !r.pending && !r.voided,
    );
    return buyingMonths({
      contributionDays: posted
        .filter((r) => r.kind === "contribution" && r.amount > 0)
        .map((r) => r.posted),
      reportDays: [...balances.entries()]
        .filter(([id]) => counted.has(id))
        .flatMap(([, list]) => list.map((b) => b.day)),
      firstTransactionDay: posted.reduce<string | null>(
        (first, r) => (first === null || r.posted < first ? r.posted : first),
        null,
      ),
      today: localDateStr(),
    });
  }),
});
