import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types/index";

/**
 * Guyton-Klinger's real anchor rate: the first retirement year's portfolio draw (spending less
 * Social Security) over the balance carried into it. Null while Social Security covers all of it
 * (the engine anchors later), or with no retirement year or balance.
 */
export function gkAnchorRate(
  years: readonly (
    | Pick<EngineAccumulationYear, "phase" | "retirementBalance">
    | Pick<
        EngineDecumulationYear,
        "phase" | "retirementBalance" | "projectedExpenses" | "ssIncome"
      >
  )[],
): number | null {
  const i = years.findIndex((y) => y.phase === "decumulation");
  const first = years[i];
  if (i <= 0 || first?.phase !== "decumulation") return null;
  const carriedIn = years[i - 1]!.retirementBalance;
  const draw = first.projectedExpenses - first.ssIncome;
  return carriedIn > 0 && draw > 0 ? draw / carriedIn : null;
}
