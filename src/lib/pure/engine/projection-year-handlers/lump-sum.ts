/**
 * applyLumpSums — apply one-time lump-sum injections to the account parts.
 * Shared by the accumulation-year and decumulation-year handlers.
 */
import type { LumpSum } from "../types/year-overrides";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import { lumpSumParts, runLumpSums } from "../lump-sum-targets";
import { equalShares, inflowShares } from "../individual-accounts/part-weights";
import { placeWhole } from "@/lib/pure/accounts/place-whole";

/**
 * Apply one-time lump-sum injections for the current year to the account
 * parts (`state.indBalance`); the settled point after the flow gives the
 * categories and the tax buckets.
 */
export function applyLumpSums(
  lumpSums: readonly LumpSum[],
  ctx: ProjectionContext,
  state: ProjectionLoopState,
): void {
  const { ledgerRuns, indAccounts, indKey, lumpSumTargets } = ctx;
  const { indBalance } = state;

  for (const ls of runLumpSums(lumpSums, lumpSumTargets)) {
    // Its parts take it, by balance when its target is no single part
    if (ledgerRuns) {
      const targets = lumpSumParts(ls, indAccounts);
      const shares = inflowShares(
        targets.map((ia) => Math.max(0, indBalance.get(indKey(ia)) ?? 0)),
        equalShares(targets.length),
      );
      const placed = placeWhole(
        ls.amount,
        shares.map((s) => ls.amount * s),
      );
      targets.forEach((ia, i) => {
        const key = indKey(ia);
        indBalance.set(key, (indBalance.get(key) ?? 0) + placed[i]!);
      });
    }
  }
}
