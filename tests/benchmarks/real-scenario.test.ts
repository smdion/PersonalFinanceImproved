import { describe, it } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeTrinityInput,
  makeMCInput,
  makeStandardInput,
  ASSET_CLASSES,
  CORRELATIONS,
  CURRENT_GLIDE_PATH,
} from "./benchmark-helpers";

describe(
  "Full lifecycle scenario: accumulation + decumulation",
  { timeout: 120000 },
  () => {
    it("compares accumulation+decumulation vs retirement-only", () => {
      // Accumulation + decumulation with representative values
      const fullInput = makeStandardInput({
        currentAge: 35,
        retirementAge: 55,
        projectionEndAge: 95,
        currentSalary: 250000,
        salaryGrowthRate: 0.03,
        startingBalances: {
          preTax: 170000,
          taxFree: 490000,
          hsa: 55000,
          afterTax: 12000,
          afterTaxBasis: 12000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional" as const,
            traditional: 170000,
            roth: 0,
          },
          "403b": {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 0,
          },
          hsa: { structure: "single_bucket" as const, balance: 55000 },
          ira: {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 490000,
          },
          brokerage: {
            structure: "basis_tracking" as const,
            balance: 12000,
            basis: 12000,
          },
        },
        annualExpenses: 85000,
        decumulationDefaults: {
          withdrawalRate: 0.033,
          withdrawalRoutingMode: "waterfall" as const,
          withdrawalOrder: [
            "401k" as const,
            "403b" as const,
            "ira" as const,
            "brokerage" as const,
            "hsa" as const,
          ],
          withdrawalSplits: {
            "401k": 0.35,
            "403b": 0,
            ira: 0.25,
            brokerage: 0.3,
            hsa: 0.1,
          },
          withdrawalTaxPreference: {
            "401k": "traditional" as const,
            ira: "traditional" as const,
          },
          distributionTaxRates: {
            traditionalFallbackRate: 0.22,
            roth: 0,
            hsa: 0,
            brokerage: 0.15,
          },
        },
      });

      // Retirement-only (skip accumulation, start with estimated retirement balance)
      const retirementOnlyInput = makeTrinityInput({
        currentAge: 55,
        retirementAge: 55,
        projectionEndAge: 95,
        annualExpenses: 90000,
        inflationRate: 0.03,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 2_750_000,
          afterTaxBasis: 2_750_000,
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
            balance: 2_750_000,
            basis: 2_750_000,
          },
        },
      });

      console.log(
        "\n=== ACCUMULATION VARIANCE: Does accumulation phase drag success? ===\n",
      );

      const fullMC = calculateMonteCarlo(
        makeMCInput(fullInput, {
          numTrials: 5000,
          seed: 42,
          assetClasses: ASSET_CLASSES,
          correlations: CORRELATIONS,
          glidePath: CURRENT_GLIDE_PATH,
          inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
        }),
      );
      const fullMedian =
        fullMC.percentileBands[fullMC.percentileBands.length - 1]?.p50 ?? 0;
      const fullP10 =
        fullMC.percentileBands[fullMC.percentileBands.length - 1]?.p10 ?? 0;

      // Portfolio value at retirement: index (55-35) = 20
      const retIdx = 55 - 35;
      const retBand = fullMC.percentileBands[retIdx];

      console.log(
        "Full lifecycle (age 35→55→95, $727K start, ~$85K/yr contributions)",
      );
      console.log(
        `  Success: ${(fullMC.successRate * 100).toFixed(1)}%  |  Median end: $${(fullMedian / 1e6).toFixed(1)}M  |  P10 end: $${(fullP10 / 1e6).toFixed(1)}M`,
      );
      if (retBand) {
        console.log(
          `  Portfolio at retirement (age 55): P10=$${(retBand.p10 / 1e6).toFixed(1)}M  P50=$${(retBand.p50 / 1e6).toFixed(1)}M  P90=$${(retBand.p90 / 1e6).toFixed(1)}M`,
        );
      }

      const retMC = calculateMonteCarlo(
        makeMCInput(retirementOnlyInput, {
          numTrials: 5000,
          seed: 42,
          assetClasses: ASSET_CLASSES,
          correlations: CORRELATIONS,
          glidePath: CURRENT_GLIDE_PATH,
          inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
        }),
      );
      const retMedian =
        retMC.percentileBands[retMC.percentileBands.length - 1]?.p50 ?? 0;
      const retP10 =
        retMC.percentileBands[retMC.percentileBands.length - 1]?.p10 ?? 0;

      console.log("\nRetirement-only (age 55→95, $2.75M start, $90K expenses)");
      console.log(
        `  Success: ${(retMC.successRate * 100).toFixed(1)}%  |  Median end: $${(retMedian / 1e6).toFixed(1)}M  |  P10 end: $${(retP10 / 1e6).toFixed(1)}M`,
      );

      console.log(
        `\nDelta: ${((fullMC.successRate - retMC.successRate) * 100).toFixed(1)}pp`,
      );
    });
  },
);
