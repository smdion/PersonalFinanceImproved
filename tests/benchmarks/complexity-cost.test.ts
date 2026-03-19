import { describe, it } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeTrinityInput,
  makeStandardInput,
  makeMCInput,
  ASSET_CLASSES,
  CORRELATIONS,
  CURRENT_GLIDE_PATH,
} from "./benchmark-helpers";

describe(
  "Complexity cost: what drags success rate?",
  { timeout: 120000 },
  () => {
    it("isolates each layer of complexity", () => {
      const mcOpts = {
        numTrials: 5000,
        seed: 42,
        assetClasses: ASSET_CLASSES,
        correlations: CORRELATIONS,
        glidePath: CURRENT_GLIDE_PATH,
        inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
      };

      // Layer 1: Pure retirement, single account, 0% tax (baseline)
      const layer1 = makeTrinityInput({
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

      // Layer 2: Same but with realistic tax rates
      const layer2 = makeTrinityInput({
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

      // Layer 3: Multi-account, realistic split (your actual portfolio at retirement est.)
      const layer3 = makeTrinityInput({
        currentAge: 55,
        retirementAge: 55,
        projectionEndAge: 95,
        annualExpenses: 90000,
        inflationRate: 0.03,
        // Estimate your portfolio at retirement: $2.77M split across accounts
        // Traditional grows from $171K, Roth from $493K, HSA from $57K, brokerage from $13K
        // Rough estimate after 18yr growth + contributions
        startingBalances: {
          preTax: 600000,
          taxFree: 1500000,
          hsa: 200000,
          afterTax: 470000,
          afterTaxBasis: 300000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional" as const,
            traditional: 600000,
            roth: 0,
          },
          "403b": {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 0,
          },
          hsa: { structure: "single_bucket" as const, balance: 200000 },
          ira: {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 1500000,
          },
          brokerage: {
            structure: "basis_tracking" as const,
            balance: 470000,
            basis: 300000,
          },
        },
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

      // Layer 4: Full lifecycle (accumulation + decumulation)
      const layer4 = makeStandardInput({
        currentAge: 37,
        retirementAge: 55,
        projectionEndAge: 95,
        currentSalary: 256000,
        salaryGrowthRate: 0.03,
        startingBalances: {
          preTax: 171302,
          taxFree: 492580,
          hsa: 56817,
          afterTax: 12618,
          afterTaxBasis: 12618,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional" as const,
            traditional: 171302,
            roth: 0,
          },
          "403b": {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 0,
          },
          hsa: { structure: "single_bucket" as const, balance: 56817 },
          ira: {
            structure: "roth_traditional" as const,
            traditional: 0,
            roth: 492580,
          },
          brokerage: {
            structure: "basis_tracking" as const,
            balance: 12618,
            basis: 12618,
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

      const layers = [
        {
          label: "1. Retirement-only, single brokerage, 0% tax",
          input: layer1,
        },
        { label: "2. + Tax rates (22% trad, 15% brokerage)", input: layer2 },
        {
          label: "3. + Multi-account split (trad/Roth/HSA/brokerage)",
          input: layer3,
        },
        {
          label: "4. Full lifecycle (accumulation + decumulation)",
          input: layer4,
        },
      ];

      console.log("\n=== COMPLEXITY COST: What drags the success rate? ===");
      console.log(
        "All use hybrid glide path, DB returns, stochastic inflation\n",
      );

      let prevSuccess = 0;
      for (const { label, input } of layers) {
        const mc = calculateMonteCarlo(makeMCInput(input, mcOpts));
        const median =
          mc.percentileBands[mc.percentileBands.length - 1]?.p50 ?? 0;
        const delta =
          prevSuccess > 0
            ? `  (${((mc.successRate - prevSuccess) * 100).toFixed(1)}pp)`
            : "";
        console.log(`${label}`);
        console.log(
          `  Success: ${(mc.successRate * 100).toFixed(1)}%${delta}  |  Median: $${(median / 1e6).toFixed(1)}M`,
        );
        prevSuccess = mc.successRate;
      }
    });
  },
);
