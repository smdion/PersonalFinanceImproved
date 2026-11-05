/**
 * Projection router helpers for the Plan Health and stress-test features.
 * Lives alongside the router so the endpoints stay thin.
 *
 *   - buildPlanHealthInputs: derives accumulationOrder and
 *     currentStockAllocationPercent for the PlanHealthCard.
 *     Called from projection.computeProjection.
 *
 *   - runStressTestScenarios: re-runs calculateProjection at the three
 *     canonical stress-test parameter sets (conservative / baseline /
 *     optimistic). Called from projection.computeStressTest.
 */

import { planEndAge } from "@/lib/pure/household-timeline";
import { loadSimulationPreset } from "@/server/helpers/simulation-preset";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { classifyAssetClasses, stockShareByAge } from "@/lib/pure/stock-share";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { calculateProjection } from "@/lib/pure/engine";
import { getStressTestScenarios } from "@/lib/pure/stress-test";
import { roundToCents } from "@/lib/utils/math";

// ---------------------------------------------------------------------------
// PlanHealthCard inputs
// ---------------------------------------------------------------------------

interface ActiveContribLite {
  accountType: string;
  allocationPriority?: number | null;
}

/**
 * accumulationOrder: distinct category names from activeContribs in their
 * allocationPriority order (lower = higher priority = filled first). The
 * validateContributionOrder() helper compares this against the CFP
 * heuristic.
 */
export function buildAccumulationOrder(
  activeContribs: readonly ActiveContribLite[],
): string[] {
  const sorted = [...activeContribs].sort(
    (a, b) => (a.allocationPriority ?? 0) - (b.allocationPriority ?? 0),
  );
  const seen = new Set<string>();
  const order: string[] = [];
  for (const c of sorted) {
    if (!seen.has(c.accountType)) {
      seen.add(c.accountType);
      order.push(c.accountType);
    }
  }
  return order;
}

/**
 * The stock allocation (percent, one decimal) the Default preset's glide
 * path assumes at `currentAge` — the same stock share VPW sizes by
 * (lib/pure/stock-share.ts: a class is stocks when any of its buckets is).
 * Null when there's no glide path or no class is mapped to buckets, so the
 * PlanHealthCard skips the glide-path warning.
 */
export async function computeCurrentStockAllocationPercent(
  db: Db,
  currentAge: number,
): Promise<number | null> {
  const [preset, bucketRows] = await Promise.all([
    loadSimulationPreset(db, DEFAULT_SIMULATION.preset),
    db.select().from(schema.assetClassBuckets),
  ]);
  const share = stockShareByAge(
    preset.glidePath,
    classifyAssetClasses(bucketRows),
    currentAge,
    currentAge,
  )?.[Math.floor(currentAge)];
  return share === undefined ? null : Math.round(share * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Stress test scenarios (re-run projection at canonical parameter sets)
// ---------------------------------------------------------------------------

type ProjectionInput = Parameters<typeof calculateProjection>[0];

interface StressTestRunInput {
  // Narrow subset of the engine input, matching what buildEnginePayload
  // exposes. We intentionally type this loosely because it's spread into
  // calculateProjection with additional overrides below; TS can't see
  // through the spread, so we cast at the call boundary.
  baseEngineInput: Omit<
    ProjectionInput,
    "decumulationDefaults" | "accumulationOverrides" | "decumulationOverrides"
  >;
  /** The household's saved "Changes by year" (resolved by the caller);
   *  omitted = none. */
  accumulationOverrides?: ProjectionInput["accumulationOverrides"];
  decumulationOverrides?: ProjectionInput["decumulationOverrides"];
  /** Fully resolved by the caller (stress-test.ts) via the shared
   *  `buildDecumulationDefaults` (_shared.ts) — the household's real
   *  routing mode, RMD/QCD handling, discretionary order, and active
   *  strategy + params. Each scenario below overrides only
   *  `withdrawalRate` (its own controlled variable: conservative /
   *  baseline / optimistic each test a different rate); everything else
   *  is the household's actual plan, not a hardcoded one. Deliberately
   *  NOT built in this file — this helper
   *  isn't a router under `projection/`, so it doesn't import
   *  `buildDecumulationDefaults` itself; resolving in the router and
   *  passing the built object down keeps this a mechanical one-field
   *  override, same shape the existing tests already exercise. */
  decumulationDefaults: ProjectionInput["decumulationDefaults"];
}

interface StressTestScenarioResult {
  label: string;
  description: string;
  returnRate: number;
  inflationRate: number;
  salaryGrowthRate: number;
  withdrawalRate: number;
  nestEggAtRetirement: number;
  sustainableWithdrawal: number;
  /** First age the plan falls short (assessPlan), null if it holds. */
  failureAge: number | null;
}

/**
 * Run the three stress-test scenarios (conservative, baseline, optimistic)
 * against the user's plan. Each scenario overrides returnRates (flat
 * schedule at the scenario's nominal rate), inflationRate, salaryGrowthRate,
 * and withdrawalRate before calling calculateProjection.
 */
export function runStressTestScenarios(
  input: StressTestRunInput,
): StressTestScenarioResult[] {
  const { baseEngineInput, decumulationDefaults } = input;
  const stressScenarios = getStressTestScenarios();

  return stressScenarios.map((scenario) => {
    const flatReturnRates: { label: string; rate: number }[] = [];
    for (
      let a = baseEngineInput.currentAge;
      a <= planEndAge(baseEngineInput);
      a++
    ) {
      flatReturnRates.push({ label: `Age ${a}`, rate: scenario.returnRate });
    }

    const scenarioDecumulationDefaults = {
      ...decumulationDefaults,
      withdrawalRate: scenario.withdrawalRate,
    };

    const result = calculateProjection({
      ...baseEngineInput,
      returnRates: flatReturnRates,
      inflationRate: scenario.inflationRate,
      // The household's gap between the two rates stays, as in a Simulation.
      ...(baseEngineInput.postRetirementInflationRate != null
        ? {
            postRetirementInflationRate:
              scenario.inflationRate +
              baseEngineInput.postRetirementInflationRate -
              baseEngineInput.inflationRate,
          }
        : {}),
      salaryGrowthRate: scenario.salaryGrowthRate,
      salaryGrowthRateByPerson: undefined, // the scenario's rate, for everyone
      decumulationDefaults: scenarioDecumulationDefaults,
      // The household's saved "Changes by year" (D6).
      accumulationOverrides: input.accumulationOverrides ?? [],
      decumulationOverrides: input.decumulationOverrides ?? [],
    } as ProjectionInput);

    const retirementYear =
      baseEngineInput.retirementYear <= baseEngineInput.asOfDate.getFullYear()
        ? result.projectionByYear[0]
        : result.projectionByYear.find(
            (p) => p.year === baseEngineInput.retirementYear,
          );
    const nestEgg = retirementYear?.retirementBalance ?? 0;

    return {
      label: scenario.label,
      description: scenario.description,
      returnRate: scenario.returnRate,
      inflationRate: scenario.inflationRate,
      salaryGrowthRate: scenario.salaryGrowthRate,
      withdrawalRate: scenario.withdrawalRate,
      nestEggAtRetirement: roundToCents(nestEgg),
      sustainableWithdrawal: result.sustainableWithdrawal,
      failureAge: assessPlan(result).failureAge,
    };
  });
}
