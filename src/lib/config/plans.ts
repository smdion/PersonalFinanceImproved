/**
 * The profile kinds a Plan holds — one of each — and how each is stored and
 * named. Shared by the server (apply, delete guards) and the header, so a
 * fifth kind is one entry here.
 */

export const PLAN_PROFILE_KINDS = [
  "salary",
  "contribution",
  "budget",
  "retirement",
] as const;

export type PlanProfileKind = (typeof PLAN_PROFILE_KINDS)[number];

/** The `scenarios` column holding a Plan's profile of each kind. */
export const PLAN_PROFILE_COLUMN = {
  budget: "budgetProfileId",
  contribution: "contributionProfileId",
  salary: "salaryProfileId",
  retirement: "retirementProfileId",
} as const satisfies Record<PlanProfileKind, string>;

/** Lower-case name of each kind, for sentences ("your active salary profile"). */
export const PLAN_PROFILE_KIND_LABELS: Record<PlanProfileKind, string> = {
  salary: "salary",
  contribution: "contribution",
  budget: "budget",
  retirement: "retirement",
};

/** Title-case name of each kind, for the header pickers. */
export const PLAN_PROFILE_KIND_TITLES: Record<PlanProfileKind, string> = {
  salary: "Salary",
  contribution: "Contributions",
  budget: "Budget",
  retirement: "Retirement",
};

export type PlanProfileIds = Record<PlanProfileKind, number | null>;
