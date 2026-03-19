import { describe, it } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeTrinityInput,
  makeMCInput,
  ASSET_CLASSES,
  IBBOTSON_CLASSES,
  CORRELATIONS,
  CURRENT_GLIDE_PATH,
  make7525GlidePath,
} from "./benchmark-helpers";

// FIRE-adjusted glide path: holds more equity through retirement.
// Rationale: Vanguard TDFs assume SS at 65 replacing ~40% of income.
// FIRE retirees at 55 with no SS need more growth runway.
// This shifts the Vanguard curve ~10 years younger (your 55 = Vanguard's 45).
// Floors equity at 40% instead of 25%.
const FIRE_ADJUSTED_GLIDE_PATH = [
  { age: 25, allocations: { 1: 0.6, 2: 0.3, 3: 0.07, 4: 0.02, 5: 0.01 } }, // 90% equity
  { age: 35, allocations: { 1: 0.57, 2: 0.3, 3: 0.09, 4: 0.03, 5: 0.01 } }, // 87% equity
  { age: 45, allocations: { 1: 0.52, 2: 0.25, 3: 0.15, 4: 0.06, 5: 0.02 } }, // 77% equity
  { age: 55, allocations: { 1: 0.48, 2: 0.25, 3: 0.17, 4: 0.06, 5: 0.04 } }, // 73% equity (was 63%)
  { age: 65, allocations: { 1: 0.42, 2: 0.21, 3: 0.24, 4: 0.08, 5: 0.05 } }, // 63% equity (was 48%)
  { age: 75, allocations: { 1: 0.32, 2: 0.16, 3: 0.3, 4: 0.13, 5: 0.09 } }, // 48% equity (was 30%)
  { age: 85, allocations: { 1: 0.27, 2: 0.13, 3: 0.3, 4: 0.17, 5: 0.13 } }, // 40% equity (was 25%)
];

// Even more aggressive FIRE path — floors at 50%
const FIRE_AGGRESSIVE_GLIDE_PATH = [
  { age: 25, allocations: { 1: 0.6, 2: 0.3, 3: 0.07, 4: 0.02, 5: 0.01 } }, // 90% equity
  { age: 35, allocations: { 1: 0.57, 2: 0.3, 3: 0.09, 4: 0.03, 5: 0.01 } }, // 87% equity
  { age: 45, allocations: { 1: 0.52, 2: 0.25, 3: 0.15, 4: 0.06, 5: 0.02 } }, // 77% equity
  { age: 55, allocations: { 1: 0.5, 2: 0.27, 3: 0.15, 4: 0.05, 5: 0.03 } }, // 77% equity
  { age: 65, allocations: { 1: 0.45, 2: 0.23, 3: 0.2, 4: 0.07, 5: 0.05 } }, // 68% equity
  { age: 75, allocations: { 1: 0.37, 2: 0.18, 3: 0.27, 4: 0.11, 5: 0.07 } }, // 55% equity
  { age: 85, allocations: { 1: 0.33, 2: 0.17, 3: 0.27, 4: 0.13, 5: 0.1 } }, // 50% equity
];

// 60/40 flat — classic balanced portfolio, never changes
const FLAT_6040 = [
  { age: 0, allocations: { 1: 0.4, 2: 0.2, 3: 0.25, 4: 0.1, 5: 0.05 } },
  { age: 120, allocations: { 1: 0.4, 2: 0.2, 3: 0.25, 4: 0.1, 5: 0.05 } },
];

describe("Diagnosing the gap", { timeout: 120000 }, () => {
  it("isolates each conservative factor", () => {
    const engineInput = makeTrinityInput({
      currentAge: 55,
      retirementAge: 55,
      projectionEndAge: 95,
      annualExpenses: 90000,
      inflationRate: 0.03,
      startingBalances: {
        preTax: 0,
        taxFree: 0,
        hsa: 0,
        afterTax: 2_770_000,
        afterTaxBasis: 2_770_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional" as const,
          traditional: 0,
          roth: 0,
        },
        "403b": {
          structure: "roth_traditional" as const,
          traditional: 0,
          roth: 0,
        },
        hsa: { structure: "single_bucket" as const, balance: 0 },
        ira: {
          structure: "roth_traditional" as const,
          traditional: 0,
          roth: 0,
        },
        brokerage: {
          structure: "basis_tracking" as const,
          balance: 2_770_000,
          basis: 2_770_000,
        },
      },
    });

    const configs = [
      {
        label: "1. cFIREsim-equivalent (Ibbotson + 75/25 + fixed inflation)",
        assetClasses: IBBOTSON_CLASSES,
        correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
        glidePath: make7525GlidePath(),
        inflationRisk: undefined,
      },
      {
        label: "2. + stochastic inflation (2.5% ± 1.2%)",
        assetClasses: IBBOTSON_CLASSES,
        correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
        glidePath: make7525GlidePath(),
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
      {
        label: "3. Current Vanguard TDF glide path (25% equity floor)",
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: CURRENT_GLIDE_PATH,
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
      {
        label: "4. FIRE-adjusted glide path (40% equity floor)",
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: FIRE_ADJUSTED_GLIDE_PATH,
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
      {
        label: "5. FIRE-aggressive glide path (50% equity floor)",
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: FIRE_AGGRESSIVE_GLIDE_PATH,
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
      {
        label: "6. Flat 60/40 (classic balanced, never changes)",
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: FLAT_6040,
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
      {
        label:
          "7. Flat 75/25 with DB returns (cFIREsim-style allocation, our returns)",
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: make7525GlidePath(),
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      },
    ];

    console.log("\n=== GLIDE PATH COMPARISON: Finding the sweet spot ===");
    console.log(
      "Scenario: $2.77M portfolio, $90k/yr spending, 40yr retirement (age 55→95)\n",
    );

    for (const cfg of configs) {
      const mc = calculateMonteCarlo(
        makeMCInput(engineInput, {
          numTrials: 5000,
          seed: 42,
          assetClasses: cfg.assetClasses,
          correlations: cfg.correlations,
          glidePath: cfg.glidePath,
          inflationRisk: cfg.inflationRisk,
        }),
      );
      const medianEnd =
        mc.percentileBands[mc.percentileBands.length - 1]?.p50 ?? 0;
      const p10End =
        mc.percentileBands[mc.percentileBands.length - 1]?.p10 ?? 0;
      console.log(`${cfg.label}`);
      console.log(
        `  Success: ${(mc.successRate * 100).toFixed(1)}%  |  Median end: $${(medianEnd / 1e6).toFixed(1)}M  |  P10 end: $${(p10End / 1e6).toFixed(1)}M`,
      );
    }
  });
});
