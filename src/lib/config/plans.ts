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

/** A Plan's profile ids, keyed by kind. */
export function planProfileIds(plan: {
  [K in (typeof PLAN_PROFILE_COLUMN)[PlanProfileKind]]: number | null;
}): PlanProfileIds {
  return {
    salary: plan.salaryProfileId,
    contribution: plan.contributionProfileId,
    budget: plan.budgetProfileId,
    retirement: plan.retirementProfileId,
  };
}

/**
 * Whether a Plan is the one in use: every profile it names is the active
 * one of that kind. A kind the Plan leaves empty (older Plans) matches
 * anything, since applying it leaves that kind alone.
 */
export function planMatchesActive(
  plan: PlanProfileIds,
  active: PlanProfileIds,
): boolean {
  return PLAN_PROFILE_KINDS.every(
    (k) => plan[k] == null || plan[k] === active[k],
  );
}

/** The first Plan whose profiles are exactly the given set (all four named). */
export function findPlanWithProfiles<
  T extends { id: number } & Parameters<typeof planProfileIds>[0],
>(plans: readonly T[], ids: PlanProfileIds): T | undefined {
  return plans.find((p) => {
    const own = planProfileIds(p);
    return PLAN_PROFILE_KINDS.every((k) => own[k] === ids[k]);
  });
}

/** Why a profile can't be deleted while Plans use it (server guard and UI). */
export function planInUseMessage(
  kind: PlanProfileKind,
  planNames: readonly string[],
): string {
  const one = planNames.length === 1;
  return `Can't delete: used by ${one ? "Plan" : "Plans"} ${planNames.join(", ")}. Choose a different ${PLAN_PROFILE_KIND_LABELS[kind]} profile in ${one ? "that Plan" : "those Plans"} first.`;
}
