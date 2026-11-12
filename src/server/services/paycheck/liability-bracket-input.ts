import { TRPCError } from "@trpc/server";
import type { TaxBracketInput } from "@/lib/pure/paycheck/paycheck.types";
import {
  buildLiabilityBracketInput,
  StandardW4BracketsRequiredError,
} from "@/lib/pure/paycheck/liability-brackets";
import type { WithholdingTableRow } from "@/lib/pure/paycheck/withholding";

/** buildLiabilityBracketInput for a service: its domain error answered as
 *  the client's BAD_REQUEST, with the same message. */
export function liabilityBracketInput(
  bracketRow: WithholdingTableRow,
  limits: Map<string, number>,
): TaxBracketInput {
  try {
    return buildLiabilityBracketInput(bracketRow, limits);
  } catch (e) {
    if (e instanceof StandardW4BracketsRequiredError)
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}
