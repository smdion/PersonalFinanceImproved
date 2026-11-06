/** The one writer of employer match terms: every account and profile-entry
 *  write stores its rate through these (lib/pure/contributions/match-writes). */
import { TRPCError } from "@trpc/server";
import {
  MAX_MATCH_RATE,
  accountMatchColumns,
  matchRefused,
} from "@/lib/pure/contributions/match-writes";
import { PERCENT_MATCH } from "@/lib/utils/match-rate";

type Stored = string | number | null | undefined;

function assertMatchFits(...args: Parameters<typeof matchRefused>): void {
  if (matchRefused(...args))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `An employer match is 0% to ${MAX_MATCH_RATE * 100}%, to two decimals: enter 50 for 50%.`,
    });
}

/** An account write's match columns, refused when it raises the rate past
 *  the bound. `stored` is the row before (null on create). */
export function accountMatchWrite(
  type: string,
  incoming: { employerMatchValue?: Stored; employerMatchRate?: Stored },
  stored: { employerMatchValue: Stored; employerMatchRate: Stored } | null,
): ReturnType<typeof accountMatchColumns> {
  const columns = accountMatchColumns(type, incoming, stored);
  assertMatchFits(
    type === PERCENT_MATCH,
    { rate: columns.employerMatchRate, value: columns.employerMatchValue },
    { rate: stored?.employerMatchRate, value: stored?.employerMatchValue },
  );
  return columns;
}
