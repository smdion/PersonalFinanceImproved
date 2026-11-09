/**
 * Plans — a named set of profiles, one of each kind (docs/RULES.md
 * "Profiles and Plans"). The rules the server (apply, delete guards) and the
 * header / Compare Plans share.
 */
import {
  PLAN_PROFILE_KINDS,
  PLAN_PROFILE_KIND_LABELS,
  type PlanProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";

/** A Plan row's profile ids, keyed by kind. */
export function planProfileIds(plan: {
  salaryProfileId: number | null;
  contributionProfileId: number | null;
  budgetProfileId: number | null;
  retirementProfileId: number | null;
}): PlanProfileIds {
  return {
    salary: plan.salaryProfileId,
    contribution: plan.contributionProfileId,
    budget: plan.budgetProfileId,
    retirement: plan.retirementProfileId,
  };
}

/**
 * Whether a Plan is the set of profiles in use: it names all four kinds and each
 * is active. A Plan with an empty slot never matches.
 */
export function planMatchesActive(
  plan: PlanProfileIds,
  active: PlanProfileIds,
): boolean {
  return PLAN_PROFILE_KINDS.every(
    (k) => plan[k] != null && plan[k] === active[k],
  );
}

/** The kinds applying a Plan would change — named, and not already active. */
export function planChanges(
  plan: PlanProfileIds,
  active: PlanProfileIds,
): { kind: PlanProfileKind; id: number }[] {
  return PLAN_PROFILE_KINDS.flatMap((kind) => {
    const id = plan[kind];
    return id != null && id !== active[kind] ? [{ kind, id }] : [];
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

/** Why the active profiles can't be saved as a Plan: each kind with no
 *  active profile, named. Null when every kind has one. */
export function planSaveBlockedReason(
  active: Partial<Record<PlanProfileKind, number | null | undefined>>,
): string | null {
  const missing = PLAN_PROFILE_KINDS.filter((k) => active[k] == null).map(
    (k) => PLAN_PROFILE_KIND_LABELS[k],
  );
  if (missing.length === 0) return null;
  const last = missing.pop()!;
  const named = missing.length ? `${missing.join(", ")} and ${last}` : last;
  return `To save a Plan, make a ${named} profile active first.`;
}
