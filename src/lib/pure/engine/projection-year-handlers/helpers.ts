/**
 * Shared helpers used by both accumulation-year and decumulation-year handlers.
 */
import { isPreTaxType } from "../../../config/account-types";
import { rmdOwnerOf } from "../rmd-enforcement";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/**
 * Refresh the per-person prior-year Traditional balance map after a year's
 * individual-account balances settle. Used by both accumulation-year and
 * decumulation-year handlers for per-person RMD tracking.
 */
export function updatePerPersonTradBalance(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  if (ctx.rmdStartAgeByPerson.size === 0 || !ctx.hasIndividualAccounts) return;
  state.priorYearEndTradByPerson.clear();
  for (const ia of ctx.indAccounts) {
    const owner = rmdOwnerOf(ia, ctx.primaryPersonId);
    if (owner != null && isPreTaxType(ia.taxType)) {
      const balance = state.indBalance.get(ctx.indKey(ia)) ?? 0;
      const prev = state.priorYearEndTradByPerson.get(owner) ?? 0;
      state.priorYearEndTradByPerson.set(owner, prev + balance);
    }
  }
}
