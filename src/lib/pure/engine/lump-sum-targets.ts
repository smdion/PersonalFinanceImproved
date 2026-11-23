/**
 * A lump sum's account part, resolved once per run into the run context: its
 * stored account id first, else the one name match. The year logic reads only `RunLumpSum`.
 */
import type {
  AccountKey,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
import { accountIdKeyOf, hasRealAccount } from "../accounts/account-part";
import { isRetirementMoney } from "../../config/account-types";
import { taxTypeOnSide } from "../../config/tax-treatment-buckets";
import { declareOpeningParts } from "./opening-state";
import { portfolioFirst, retirementFirst } from "./individual-accounts/ledger";
import type {
  LumpSum,
  UnresolvedLumpSum,
  UnresolvedLumpSumReason,
} from "./types/year-overrides";
import type { ProjectionInput } from "./types/projection-result";

/** Where a lump sum lands: the one part its target picks, by key; no single
 *  part (shared by balance within its parent, J15), and why; or no account
 *  named (the first part). */
export type LumpSumTarget =
  | { kind: "part"; key: AccountKey }
  | { kind: "unresolved"; reason: UnresolvedLumpSumReason }
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

/** @internal A lump sum's target among `parts`: its stored account, else (no
 *  id, or an absent one, as a restore that skipped the ladder) its name. */
export function lumpSumTargetOf(
  ls: LumpSum,
  parts: readonly IndividualAccountInput[],
): LumpSumTarget {
  const own = partsOf(ls, parts);
  const id = ls.targetPerformanceAccountId;
  if (id != null) return storedTarget(ls, id, own);
  if (!ls.targetAccountName) return { kind: "unnamed" };
  return namedTarget(ls, own);
}

/** The stored account's part of the lump sum's tax type, its owner's (none
 *  stored: joint); no such part is unresolved, never a name match. */
function storedTarget(
  ls: LumpSum,
  performanceAccountId: number,
  own: readonly IndividualAccountInput[],
): LumpSumTarget {
  const key = accountIdKeyOf({
    performanceAccountId,
    category: ls.targetAccount,
    taxType: taxTypeOnSide(ls.targetAccount, ls.taxType),
    ownerPersonId: ls.targetOwnerPersonId ?? null,
  });
  return own.some((ia) => accountIdKeyOf(ia) === key)
    ? { kind: "part", key }
    : { kind: "unresolved", reason: "accountGone" };
}

/** The one part a name picks (its owner name's parts, when it has any);
 *  several or none is unresolved. An unlinked account's part is its row's. */
function namedTarget(
  ls: LumpSum,
  own: readonly IndividualAccountInput[],
): LumpSumTarget {
  const named = own.filter((ia) => ia.name === ls.targetAccountName);
  const owned = named.filter((ia) => ia.ownerName === ls.targetOwnerName);
  const picked = ls.targetOwnerName && owned.length > 0 ? owned : named;
  if (picked.length === 1)
    return { kind: "part", key: accountIdKeyOf(picked[0]!) };
  return {
    kind: "unresolved",
    reason: picked.length > 1 ? "nameMatchesSeveral" : "nameMatchesNone",
  };
}

/** A run's lump sums resolved: the parts they resolve over (the run's
 *  declared parts; none when it holds no real account), each one's target,
 *  and those that pick no single part, by year (none without parts). */
export type ResolvedLumpSums = {
  parts: readonly IndividualAccountInput[];
  targets: LumpSumTargets;
  unresolved: UnresolvedLumpSum[];
};

/** Resolves every lump sum of the run's overrides, both phases. */
export function resolveLumpSums(input: ProjectionInput): ResolvedLumpSums {
  const years = [
    ...input.accumulationOverrides,
    ...input.decumulationOverrides,
  ].flatMap((o) => (o.lumpSums ?? []).map((ls) => ({ year: o.year, ls })));
  const declared =
    years.length > 0
      ? declareOpeningParts(input.individualAccounts, input)
      : [];
  const parts = declared.some(hasRealAccount) ? declared : [];
  const targets = new Map(
    years.map(({ ls }) => [ls, lumpSumTargetOf(ls, parts)]),
  );
  const unresolved = years.flatMap(({ year, ls }) => {
    const target = targets.get(ls)!;
    return target.kind === "unresolved" && parts.length > 0
      ? [
          {
            year,
            category: ls.targetAccount,
            amount: ls.amount,
            reason: target.reason,
          },
        ]
      : [];
  });
  return { parts, targets, unresolved };
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
