/**
 * Projection router helpers extracted from projection.ts for v0.5
 * expert-review work (M1/M2/M6). Lives alongside the router so the
 * endpoints stay thin.
 *
 *   - buildPlanHealthInputs: derives accumulationOrder (M1) and
 *     currentStockAllocationPercent (M6) for the PlanHealthCard.
 *     Called from projection.computeProjection.
 *
 *   - runStressTestScenarios: re-runs calculateProjection at the three
 *     canonical stress-test parameter sets (conservative / baseline /
 *     optimistic). Called from projection.computeStressTest.
 */

import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { db } from "@/lib/db";
import { calculateProjection } from "@/lib/calculators/engine";
import {
  type AccountCategory,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS as CONFIG_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { getStressTestScenarios } from "@/lib/pure/stress-test";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "@/server/helpers";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

type DbType = typeof db;

// ---------------------------------------------------------------------------
// M1 + M6 — PlanHealthCard inputs
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
 * currentStockAllocationPercent: interpolate the active glide path at the
 * user's current age and sum the allocations for asset classes whose name
 * contains "Equit" or "Stock". Returns null if no glide path is configured
 * (the PlanHealthCard will then skip the M6 warning).
 */
export async function computeCurrentStockAllocationPercent(
  db: DbType,
  currentAge: number,
): Promise<number | null> {
  const [gpRows, classRows] = await Promise.all([
    db
      .select({
        age: schema.glidePathAllocations.age,
        assetClassId: schema.glidePathAllocations.assetClassId,
        allocation: schema.glidePathAllocations.allocation,
      })
      .from(schema.glidePathAllocations),
    db
      .select({
        id: schema.assetClassParams.id,
        name: schema.assetClassParams.name,
      })
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true))
      .orderBy(asc(schema.assetClassParams.sortOrder)),
  ]);
  if (gpRows.length === 0 || classRows.length === 0) return null;

  const stockClassIds = new Set<number>(
    (classRows as { id: number; name: string }[])
      .filter((c) => /equit|stock/i.test(c.name))
      .map((c) => c.id),
  );
  if (stockClassIds.size === 0) return null;

  // Group glide path by age, then bracket-interpolate at currentAge.
  const byAge = new Map<number, Record<number, number>>();
  for (const r of gpRows as {
    age: number;
    assetClassId: number;
    allocation: string | null;
  }[]) {
    if (!byAge.has(r.age)) byAge.set(r.age, {});
    byAge.get(r.age)![r.assetClassId] = toNumber(r.allocation);
  }
  const ages = Array.from(byAge.keys()).sort((a, b) => a - b);
  if (ages.length === 0) return null;

  let lowerAge = ages[0]!;
  let upperAge = ages[ages.length - 1]!;
  if (currentAge <= lowerAge) {
    upperAge = lowerAge;
  } else if (currentAge >= upperAge) {
    lowerAge = upperAge;
  } else {
    for (let i = 0; i < ages.length - 1; i++) {
      if (currentAge >= ages[i]! && currentAge <= ages[i + 1]!) {
        lowerAge = ages[i]!;
        upperAge = ages[i + 1]!;
        break;
      }
    }
  }
  const lowerAlloc = byAge.get(lowerAge)!;
  const upperAlloc = byAge.get(upperAge)!;
  const t =
    upperAge === lowerAge ? 0 : (currentAge - lowerAge) / (upperAge - lowerAge);

  let stockSum = 0;
  for (const id of stockClassIds) {
    const lo = lowerAlloc[id] ?? 0;
    const hi = upperAlloc[id] ?? 0;
    stockSum += lo + (hi - lo) * t;
  }
  return Math.round(stockSum * 100 * 10) / 10;
}

// ---------------------------------------------------------------------------
// M2 — Stress test scenarios (re-run projection at canonical parameter sets)
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
  /** Pre-built strategy params (caller already has this from
   *  buildStrategyParams(settings) in projection.ts). */
  userStrategyParams: ProjectionInput["decumulationDefaults"]["strategyParams"];
  /** Active strategy key resolved from settings. */
  activeStrategy: WithdrawalStrategyType;
  distributionTaxRates: ProjectionInput["decumulationDefaults"]["distributionTaxRates"];
  avgRetirementAge: number;
}

export interface StressTestScenarioResult {
  label: string;
  description: string;
  returnRate: number;
  inflationRate: number;
  salaryGrowthRate: number;
  withdrawalRate: number;
  nestEggAtRetirement: number;
  sustainableWithdrawal: number;
  portfolioDepletionAge: number | null;
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
  const {
    baseEngineInput,
    userStrategyParams,
    activeStrategy,
    distributionTaxRates,
    avgRetirementAge,
  } = input;
  const stressScenarios = getStressTestScenarios();

  return stressScenarios.map((scenario) => {
    const flatReturnRates: { label: string; rate: number }[] = [];
    for (
      let a = baseEngineInput.currentAge;
      a <= baseEngineInput.projectionEndAge;
      a++
    ) {
      flatReturnRates.push({ label: `Age ${a}`, rate: scenario.returnRate });
    }

    const decumulationDefaults = {
      withdrawalRate: scenario.withdrawalRate,
      withdrawalRoutingMode: "bracket_filling" as const,
      withdrawalOrder: getDefaultDecumulationOrder() as AccountCategory[],
      withdrawalSplits: { ...CONFIG_WITHDRAWAL_SPLITS } as Record<
        AccountCategory,
        number
      >,
      withdrawalTaxPreference: {},
      distributionTaxRates,
      withdrawalStrategy: activeStrategy,
      strategyParams: userStrategyParams,
    };

    const result = calculateProjection({
      ...baseEngineInput,
      returnRates: flatReturnRates,
      inflationRate: scenario.inflationRate,
      salaryGrowthRate: scenario.salaryGrowthRate,
      decumulationDefaults,
      accumulationOverrides: [],
      decumulationOverrides: [],
    } as ProjectionInput);

    const retirementYear =
      baseEngineInput.currentAge >= avgRetirementAge
        ? result.projectionByYear[0]
        : result.projectionByYear.find((p) => p.age === avgRetirementAge);
    const nestEgg = retirementYear?.endBalance ?? 0;

    return {
      label: scenario.label,
      description: scenario.description,
      returnRate: scenario.returnRate,
      inflationRate: scenario.inflationRate,
      salaryGrowthRate: scenario.salaryGrowthRate,
      withdrawalRate: scenario.withdrawalRate,
      nestEggAtRetirement: roundToCents(nestEgg),
      sustainableWithdrawal: result.sustainableWithdrawal,
      portfolioDepletionAge: result.portfolioDepletionAge,
    };
  });
}
