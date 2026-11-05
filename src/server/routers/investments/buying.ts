/** Always Be Buying, month by month: whether SimpleFIN saw a deposit into
 *  a counted feed each whole month it covered (lib/pure/investments/always-buying.ts). */
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import { buyingMonths } from "@/lib/pure/investments/always-buying";
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
    // Per feed — coverage is judged feed by feed (lib/pure/investments/always-buying.ts).
    return buyingMonths({
      feeds: [...counted].map((id) => ({
        contributionDays: posted
          .filter(
            (r) =>
              r.simplefinAccountId === id &&
              r.kind === "contribution" &&
              r.amount > 0,
          )
          .map((r) => r.posted),
        reportDays: (balances.get(id) ?? []).map((b) => b.day),
      })),
      firstTransactionDay: posted.reduce<string | null>(
        (first, r) => (first === null || r.posted < first ? r.posted : first),
        null,
      ),
      today: ctx.scope.today,
    });
  }),
});
