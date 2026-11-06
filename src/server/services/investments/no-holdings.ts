/** The Current Balances figures, plus the accounts whose feeds send no
 *  holdings (left out of the market entries): each one's balance change
 *  into each close, from the figures' own dated reports. */
import {
  unpricedMoves,
  type UnpricedMove,
} from "@/lib/pure/accounts/current-balance-groups";
import type { BalanceAt } from "@/lib/pure/accounts/current-balances";

type Figures = {
  balances: Parameters<typeof unpricedMoves>[0]["balances"];
  entryMoves: readonly { key: string }[];
  movement: readonly { day: string }[];
  balanceAtClose: BalanceAt;
  institutionOf: (feedId: number) => string;
};

export function withNoHoldings<R extends Figures>({
  balanceAtClose,
  institutionOf,
  ...r
}: R): Omit<R, "balanceAtClose" | "institutionOf"> & {
  unpricedMoves: UnpricedMove[];
} {
  return {
    ...r,
    unpricedMoves: unpricedMoves({
      balances: r.balances,
      marketKeys: new Set(r.entryMoves.map((e) => e.key)),
      institutionOf,
      sessions: r.movement.map((c) => c.day),
      balanceAt: balanceAtClose,
    }),
  };
}
