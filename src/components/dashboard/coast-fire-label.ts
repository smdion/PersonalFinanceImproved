/** A retiree's "unreachable" Coast FIRE verdict: the plan fails, not
 *  contributions falling short. One caption for the card, tile and note. */
export const RETIRED_PLAN_FAILS = "Already retired: the plan doesn't pass";

/** The dashboard's Coast FIRE verdict as a label. */
export function coastFireLabel(
  result: {
    status: "already_coast" | "found" | "unreachable";
    coastFireAge: number | null;
    retired: boolean;
  },
  ageLabel: (age: number) => string,
): string {
  if (result.status === "unreachable")
    return result.retired ? RETIRED_PLAN_FAILS : "Not reachable";
  if (result.status === "already_coast") return "Already Coast";
  return ageLabel(result.coastFireAge ?? 0);
}
