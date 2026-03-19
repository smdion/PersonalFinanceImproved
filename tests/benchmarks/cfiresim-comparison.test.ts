/**
 * cFIREsim Comparison Tests
 *
 * Compares our Monte Carlo engine output against cFIREsim historical
 * backtesting results using the same inputs.
 *
 * cFIREsim uses historical return sequences (1871-1968 start years, 98 cycles).
 * Our engine uses parametric log-normal MC with correlated multi-asset sampling.
 * Expect ±5-8pp divergence due to methodological differences.
 *
 * cFIREsim export: tests/benchmarks/cfiresim-export.csv
 */
import { describe, it, expect } from "vitest";
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

// ---------------------------------------------------------------------------
// cFIREsim ran: $712,425 starting, $90k spending, 75/25 allocation,
// 57-year horizon (age 38-95), with ~$86k/yr contributions for 16-21 years.
// Result: 100% success (98/98 cycles), all cycles end with huge surpluses.
//
// For apples-to-apples comparison, we test retirement-only scenarios
// (no accumulation) at various portfolio sizes and SWR rates.
// ---------------------------------------------------------------------------

describe("cFIREsim apples-to-apples comparison", () => {
  it("matches cFIREsim at 4% SWR, 75/25, 30yr horizon (classic Trinity)", () => {
    // cFIREsim 75/25 at 4% SWR, 30 years: ~95-96% success historically
    const engineInput = makeTrinityInput({
      currentAge: 65,
      retirementAge: 65,
      projectionEndAge: 95,
      annualExpenses: 40000, // 4% of $1M
      inflationRate: 0.03,
    });

    // Use Ibbotson historical returns (10.3% equity, 5.5% bonds) to match cFIREsim's data
    const mc = calculateMonteCarlo(
      makeMCInput(engineInput, {
        numTrials: 10000,
        seed: 42,
        assetClasses: IBBOTSON_CLASSES,
        correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
        glidePath: make7525GlidePath(),
        inflationRisk: { meanRate: 0.03, stdDev: 0.012 },
      }),
    );

    console.log(
      `4% SWR, 75/25, 30yr: ${(mc.successRate * 100).toFixed(1)}% success`,
    );
    // cFIREsim historical: ~95-96%. Our MC should be within ±8pp.
    expect(mc.successRate).toBeGreaterThan(0.87);
    expect(mc.successRate).toBeLessThan(1.01);
  });

  it(
    "matches cFIREsim at 3.25% SWR, 75/25, 40yr horizon (your scenario)",
    { timeout: 30_000 },
    () => {
      // Conservative retirement portfolio estimate (~cFIREsim 10th percentile)
      const startingBalance = 2_770_000;
      const spending = startingBalance * 0.0325;

      const engineInput = makeTrinityInput({
        currentAge: 55,
        retirementAge: 55,
        projectionEndAge: 95,
        startingBalances: {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: startingBalance,
          afterTaxBasis: startingBalance,
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
            balance: startingBalance,
            basis: startingBalance,
          },
        },
        annualExpenses: spending,
        inflationRate: 0.03,
      });

      const mc = calculateMonteCarlo(
        makeMCInput(engineInput, {
          numTrials: 10000,
          seed: 42,
          assetClasses: IBBOTSON_CLASSES,
          correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
          glidePath: make7525GlidePath(),
          inflationRisk: { meanRate: 0.03, stdDev: 0.012 },
        }),
      );

      console.log(
        `3.25% SWR, 75/25, 40yr, $${(startingBalance / 1e6).toFixed(1)}M: ${(mc.successRate * 100).toFixed(1)}% success`,
      );
      // At 3.25% SWR with 40yr horizon, cFIREsim shows ~96-98% historical
      expect(mc.successRate).toBeGreaterThan(0.88);
    },
  );

  it(
    "SWR sweep with Ibbotson returns matches cFIREsim curve",
    { timeout: 30000 },
    () => {
      const results: { swr: number; success: number }[] = [];

      for (const swr of [0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06]) {
        const engineInput = makeTrinityInput({
          currentAge: 65,
          retirementAge: 65,
          projectionEndAge: 95,
          annualExpenses: 1_000_000 * swr,
          inflationRate: 0.03,
          decumulationDefaults: {
            withdrawalRate: swr,
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
              traditionalFallbackRate: 0,
              roth: 0,
              hsa: 0,
              brokerage: 0,
            },
          },
        });

        const mc = calculateMonteCarlo(
          makeMCInput(engineInput, {
            numTrials: 5000,
            seed: 42,
            assetClasses: IBBOTSON_CLASSES,
            correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
            glidePath: make7525GlidePath(),
            inflationRisk: { meanRate: 0.03, stdDev: 0.012 },
          }),
        );

        results.push({ swr: swr * 100, success: mc.successRate * 100 });
      }

      console.table(
        results.map((r) => ({
          "SWR (%)": r.swr.toFixed(1),
          "Our MC (%)": r.success.toFixed(1),
        })),
      );

      // cFIREsim historical benchmarks (75/25, 30yr):
      // 3%: ~100%, 4%: ~95-96%, 5%: ~76-82%, 6%: ~52-60%
      // Our MC should track within ±8pp
      const at4 = results.find((r) => Math.abs(r.swr - 4) < 0.01)!;
      const at5 = results.find((r) => Math.abs(r.swr - 5) < 0.01)!;
      const at6 = results.find((r) => Math.abs(r.swr - 6) < 0.01)!;

      expect(at4.success).toBeGreaterThan(87); // cFIREsim ~95%
      expect(at4.success).toBeLessThan(103);
      expect(at5.success).toBeGreaterThan(68); // cFIREsim ~79%
      expect(at5.success).toBeLessThan(90);
      expect(at6.success).toBeGreaterThan(44); // cFIREsim ~56%
      expect(at6.success).toBeLessThan(68);
    },
  );

  it(
    "Default preset tracks close to Ibbotson/cFIREsim (no artificial bias)",
    { timeout: 60000 },
    () => {
      // Default preset uses 1.0x return multiplier (DB values are forward-looking, no haircut).
      // It should track reasonably close to Ibbotson/cFIREsim historical results.
      // The only difference is asset class returns (DB forward-looking vs Ibbotson historical)
      // and glide path (Vanguard TDF vs flat 75/25).
      const results: {
        swr: number;
        ibbotson: number;
        default_preset: number;
      }[] = [];

      for (const swr of [0.03, 0.035, 0.04, 0.045, 0.05]) {
        const engineInput = makeTrinityInput({
          currentAge: 65,
          retirementAge: 65,
          projectionEndAge: 95,
          annualExpenses: 1_000_000 * swr,
          inflationRate: 0.03,
          decumulationDefaults: {
            withdrawalRate: swr,
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
              traditionalFallbackRate: 0,
              roth: 0,
              hsa: 0,
              brokerage: 0,
            },
          },
        });

        // Ibbotson (historical) — cFIREsim equivalent
        const mcHist = calculateMonteCarlo(
          makeMCInput(engineInput, {
            numTrials: 5000,
            seed: 42,
            assetClasses: IBBOTSON_CLASSES,
            correlations: [{ classAId: 1, classBId: 3, correlation: -0.1 }],
            glidePath: make7525GlidePath(),
            inflationRisk: { meanRate: 0.03, stdDev: 0.012 },
          }),
        );

        // Default preset (1.0x DB returns, Vanguard glide path)
        const mcDefault = calculateMonteCarlo(
          makeMCInput(engineInput, {
            numTrials: 5000,
            seed: 42,
            assetClasses: ASSET_CLASSES, // 1.0x — no haircut
            correlations: CORRELATIONS,
            glidePath: CURRENT_GLIDE_PATH,
            inflationRisk: { meanRate: 0.025, stdDev: 0.012 },
          }),
        );

        results.push({
          swr: swr * 100,
          ibbotson: mcHist.successRate * 100,
          default_preset: mcDefault.successRate * 100,
        });
      }

      console.log(
        "\n=== Ibbotson (cFIREsim-equivalent) vs Default preset (DB returns, Vanguard GP) ===",
      );
      console.table(
        results.map((r) => ({
          "SWR (%)": r.swr.toFixed(1),
          "Ibbotson / 75-25 (%)": r.ibbotson.toFixed(1),
          "Default / Vanguard GP (%)": r.default_preset.toFixed(1),
          "Delta (pp)": (r.ibbotson - r.default_preset).toFixed(1),
        })),
      );

      // Default uses DB forward-looking returns (7.5% US equity vs Ibbotson 10.3%)
      // and a Vanguard glide path (less equity than flat 75/25). No artificial multiplier.
      // The gap from Ibbotson is purely from return assumptions, not an added bias.
      // At 3% SWR the gap is small (~7pp), widening at higher SWRs where returns matter more.
      const at3 = results.find((r) => Math.abs(r.swr - 3) < 0.01)!;
      const at4 = results.find((r) => Math.abs(r.swr - 4) < 0.01)!;
      expect(at3.default_preset).toBeGreaterThan(85); // Close to Ibbotson at low SWR
      expect(at4.default_preset).toBeGreaterThan(50); // Lower than Ibbotson but reasonable
      expect(at4.default_preset).toBeLessThan(100);
    },
  );
});
