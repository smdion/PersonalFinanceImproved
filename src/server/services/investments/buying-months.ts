import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { buyingMonths } from "@/lib/pure/investments/always-buying";
import {
  loadAccounts,
  loadBalanceHistory,
  loadClassifiedTransactions,
} from "@/server/data/investments";

export async function loadBuyingMonths(ctx: { db: Db; scope: RequestScope }) {
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
}
