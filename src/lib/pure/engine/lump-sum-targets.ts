/**
 * A lump sum's account part, resolved once per run before the year logic
 * (`calculateProjection`, into the run context): the one place a lump sum's
 * account name is matched. The year logic reads only `RunLumpSum`.
 */
import type { IndividualAccountInput } from "../accounts/account-balances.types";
import type { AccountKey } from "../accounts/account-balances.types";
import { accountIdKeyOf, hasRealAccount } from "../accounts/account-part";
import { isRetirementMoney } from "../../config/account-types";
import { taxTypeOnSide } from "../../config/tax-treatment-buckets";
import { declareOpeningParts } from "./opening-state";
import { portfolioFirst, retirementFirst } from "./individual-accounts/ledger";
import type { LumpSum } from "./types/year-overrides";
import type { ProjectionInput } from "./types/projection-result";

/** Where a lump sum lands: the one part its target picks, by key; no single
 *  part (shared by balance within its parent, J15); or no account named
 *  (the first part). */
export type LumpSumTarget =
  | { kind: "part"; key: AccountKey }
  | { kind: "unresolved"; reason: "noMatch" }
  | { kind: "unnamed" };

/** A lump sum as the year logic reads it: its target resolved, its account
 *  name, owner name and ids left out. */
export type RunLumpSum = Omit<
  LumpSum,
  | "targetAccountName"
  | "targetOwnerName"
  | "targetPerformanceAccountId"
  | "targetOwnerPersonId"
> & { target: LumpSumTarget };

/** Each of a run's lump sums' targets, by the lump sum (as its overrides
 *  hold it): run-scoped, never stored or echoed in the result. */
export type LumpSumTargets = ReadonlyMap<LumpSum, LumpSumTarget>;

/** The parts of a lump sum's category and tax type (its side, F3). */
function partsOf(
  ls: Pick<LumpSum, "targetAccount" | "taxType">,
  parts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  const taxType = taxTypeOnSide(ls.targetAccount, ls.taxType);
  return parts.filter(
    (ia) => ia.category === ls.targetAccount && ia.taxType === taxType,
  );
}

/** A lump sum's target among `parts`: the part of its category and tax type
 *  its name picks (its owner's, else the first); a name none carries is
 *  unresolved; no name, unnamed. */
export function lumpSumTargetOf(
  ls: LumpSum,
  parts: readonly IndividualAccountInput[],
): LumpSumTarget {
  if (!ls.targetAccountName) return { kind: "unnamed" };
  const named = partsOf(ls, parts).filter(
    (ia) => ia.name === ls.targetAccountName,
  );
  const owned = named.find((ia) => ia.ownerName === ls.targetOwnerName);
  const part = (ls.targetOwnerName && owned) || named[0];
  return part
    ? { kind: "part", key: accountIdKeyOf(part) }
    : { kind: "unresolved", reason: "noMatch" };
}

/** The target of each of the run's lump sums, resolved over the parts the
 *  run declares (none when it holds no real account). */
export function lumpSumTargets(input: ProjectionInput): LumpSumTargets {
  const lumpSums = [
    ...input.accumulationOverrides,
    ...input.decumulationOverrides,
  ].flatMap((o) => o.lumpSums ?? []);
  const declared = lumpSums.some((ls) => ls.targetAccountName)
    ? declareOpeningParts(input.individualAccounts, input)
    : [];
  const parts = declared.some(hasRealAccount) ? declared : [];
  return new Map(lumpSums.map((ls) => [ls, lumpSumTargetOf(ls, parts)]));
}

/** The year's lump sums as the year logic reads them: each with its target
 *  and without its names and ids; one with no target throws. */
export function runLumpSums(
  lumpSums: readonly LumpSum[],
  targets: LumpSumTargets,
): RunLumpSum[] {
  return lumpSums.map((ls) => {
    const target = targets.get(ls);
    if (!target)
      throw new Error("A lump sum reached the year logic with no target");
    const { amount, targetAccount, taxType, targetParentCategory, label } = ls;
    return {
      amount,
      targetAccount,
      taxType,
      targetParentCategory,
      label,
      target,
    };
  });
}

/** A lump sum's parts of its category and tax type: its target's part;
 *  unresolved, the first parent's (`orderedByParent`), shared by balance;
 *  unnamed, the first. */
export function lumpSumParts(
  ls: RunLumpSum,
  parts: readonly IndividualAccountInput[],
): IndividualAccountInput[] {
  const own = partsOf(ls, parts);
  const ordered = orderedByParent(own, ls.targetParentCategory);
  const first = ordered[0];
  const { target } = ls;
  if (target.kind === "unnamed" || !first) return ordered.slice(0, 1);
  if (target.kind === "part") {
    const part = own.find((ia) => accountIdKeyOf(ia) === target.key);
    if (!part)
      throw new Error("A lump sum's part is not among the run's parts");
    return [part];
  }
  return ordered.filter(
    (ia) =>
      isRetirementMoney(ia.parentCategory) ===
      isRetirementMoney(first.parentCategory),
  );
}

/** Parts ordered by whose money it is: its parent's first (unset: Retirement
 *  first); Portfolio money skips the projection-only part while another exists. */
function orderedByParent(
  own: IndividualAccountInput[],
  parent: LumpSum["targetParentCategory"],
): IndividualAccountInput[] {
  const parentOf = (ia: IndividualAccountInput) => ia.parentCategory;
  if (isRetirementMoney(parent)) return retirementFirst(own, parentOf);
  const real = own.filter((ia) => ia.origin !== "projected");
  return real.length > 0 ? portfolioFirst(real, parentOf) : own;
}
