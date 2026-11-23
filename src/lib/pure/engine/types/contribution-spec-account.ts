/** The account a contribution spec pays into: its performance account; its
 *  own contribution account when linked to none; Simple mode's synthetic pot. */
export type ContributionSpecAccount =
  | { kind: "performance"; performanceAccountId: number }
  | { kind: "unlinked" }
  | { kind: "synthetic" };
