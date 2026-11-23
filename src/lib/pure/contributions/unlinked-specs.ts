import type { ContributionSpec } from "@/lib/pure/engine/types";

/** The setup note for contribution accounts linked to no account: each pays
 *  an account part of its own (`contrib:`), never joined to another account. */
export function unlinkedSpecsNote(
  defaults: readonly ContributionSpec[],
  switches: readonly { contributionSpecs: readonly ContributionSpec[] }[],
): string[] {
  const unlinked = new Set(
    [defaults, ...switches.map((s) => s.contributionSpecs)]
      .flat()
      .filter((spec) => spec.account.kind === "unlinked")
      .map((spec) => spec.contributionAccountId),
  );
  if (unlinked.size === 0) return [];
  return [
    unlinked.size === 1
      ? "1 contribution account isn't linked to an account, so the projection counts it as an account of its own. Link it to its account on the Contributions page to keep its contributions with its balance."
      : `${unlinked.size} contribution accounts aren't linked to an account, so the projection counts each as an account of its own. Link each to its account on the Contributions page to keep its contributions with its balance.`,
  ];
}
