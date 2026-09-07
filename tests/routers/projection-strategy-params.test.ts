/**
 * Cross-layer consistency check for withdrawal-strategy defaults.
 *
 * buildStrategyParams (server/routers/projection/_shared.ts) and
 * WITHDRAWAL_STRATEGY_CONFIG (lib/config/withdrawal-strategies.ts) each
 * independently fall back to a "default" value when the user hasn't
 * configured one. They're two layers of the same fact and previously
 * diverged silently — the endowment strategy's rollingYears default was 10
 * server-side (and in the engine) but 5 in the UI config, with nothing to
 * catch the mismatch.
 *
 * These assertions use literal expected values, not the shared constants
 * the fix introduced — importing DEFAULT_ENDOWMENT_ROLLING_YEARS into both
 * sides of the comparison would make this test pass trivially even if one
 * layer reverted to a hardcoded literal.
 */
import { describe, it, expect, vi } from "vitest";

// buildStrategyParams is a pure function of its `settings` argument — it
// doesn't touch the DB — but _shared.ts also imports `* as schema` for
// other exports in the same module, which pulls in the dialect-switching
// schema.ts. Stub it out rather than requiring a real DB connection/dialect
// resolution just to import one pure function.
vi.mock("@/lib/db/schema", () => ({}));

import {
  buildStrategyParams,
  resolveSsStartAgeBaseline,
} from "@/server/routers/projection/_shared";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";

const noOverrides = {
  gkUpperGuardrail: null,
  gkLowerGuardrail: null,
  gkIncreasePct: null,
  gkDecreasePct: null,
  gkSkipInflationAfterLoss: false,
  sdAnnualDeclineRate: null,
  cpWithdrawalPercent: null,
  cpFloorPercent: null,
  enWithdrawalPercent: null,
  enRollingYears: null,
  enFloorPercent: null,
  vdBasePercent: null,
  vdCeilingPercent: null,
  vdFloorPercent: null,
  rmdMultiplier: null,
};

describe("withdrawal-strategy defaults agree across layers", () => {
  const serverDefaults = buildStrategyParams(noOverrides);

  it("endowment: rollingYears matches", () => {
    expect(serverDefaults.endowment!.rollingYears).toBe(10);
    expect(
      WITHDRAWAL_STRATEGY_CONFIG.endowment.defaultParams.rollingYears,
    ).toBe(10);
  });

  it("endowment: withdrawalPercent and floorPercent match", () => {
    expect(serverDefaults.endowment!.withdrawalPercent).toBe(0.05);
    expect(serverDefaults.endowment!.floorPercent).toBe(0.9);
    expect(
      WITHDRAWAL_STRATEGY_CONFIG.endowment.defaultParams.withdrawalPercent,
    ).toBe(0.05);
    expect(
      WITHDRAWAL_STRATEGY_CONFIG.endowment.defaultParams.floorPercent,
    ).toBe(0.9);
  });

  it("constant_percentage: withdrawalPercent and floorPercent match", () => {
    expect(serverDefaults.constant_percentage!.withdrawalPercent).toBe(0.05);
    expect(serverDefaults.constant_percentage!.floorPercent).toBe(0.9);
    expect(
      WITHDRAWAL_STRATEGY_CONFIG.constant_percentage.defaultParams
        .withdrawalPercent,
    ).toBe(0.05);
    expect(
      WITHDRAWAL_STRATEGY_CONFIG.constant_percentage.defaultParams.floorPercent,
    ).toBe(0.9);
  });

  it("vanguard_dynamic: basePercent, ceilingPercent, floorPercent match", () => {
    expect(serverDefaults.vanguard_dynamic!.basePercent).toBe(0.05);
    expect(serverDefaults.vanguard_dynamic!.ceilingPercent).toBe(0.05);
    expect(serverDefaults.vanguard_dynamic!.floorPercent).toBe(0.025);
    const cfg = WITHDRAWAL_STRATEGY_CONFIG.vanguard_dynamic.defaultParams;
    expect(cfg.basePercent).toBe(0.05);
    expect(cfg.ceilingPercent).toBe(0.05);
    expect(cfg.floorPercent).toBe(0.025);
  });
});

describe("resolveSsStartAgeBaseline", () => {
  it("single-person household (no perPersonSettings): uses the scalar baseEngineInput value", () => {
    expect(resolveSsStartAgeBaseline(undefined, 68)).toBe(68);
  });

  it("single-entry perPersonSettings (length 1): still uses the scalar, not the per-person row", () => {
    // Matches build-engine-payload.ts's own single-person routing — a
    // length-1 perPersonSettings array is still a single-person
    // household, so there's no "multiple people could disagree" case to
    // protect against here.
    expect(resolveSsStartAgeBaseline([{ ssStartAge: 62 }], 68)).toBe(68);
  });

  it("multi-person household: uses the EARLIEST real per-person start age, ignoring a stale scalar", () => {
    // The stale scalar says 68 (nobody's really claiming that late); the
    // real per-person rows say 62 and 65. The household's actual earliest
    // actionable claiming age is 62 — the lever must be gated on that, not
    // on 68 (which would clamp "delay by 3" out of the [0, 70] range for
    // no real reason).
    const perPersonSettings = [{ ssStartAge: 65 }, { ssStartAge: 62 }];
    expect(resolveSsStartAgeBaseline(perPersonSettings, 68)).toBe(62);
  });

  it("multi-person household: matches the scalar when it isn't actually stale", () => {
    const perPersonSettings = [{ ssStartAge: 67 }, { ssStartAge: 70 }];
    expect(resolveSsStartAgeBaseline(perPersonSettings, 67)).toBe(67);
  });
});
