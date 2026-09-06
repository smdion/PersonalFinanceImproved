/**
 * `buildDecumulationDefaults` — the single resolver every projection-router
 * consumer goes through to turn a `retirement_settings` row + optional
 * client override into the engine's `decumulationDefaults`.
 *
 * These cover the three-tier precedence for the structured fields that
 * became persisted profile defaults after `withdrawalRoutingMode`:
 * `withdrawalOrder` and `withdrawalSplits`. Precedence is
 *   client (touched session) > settings (persisted) > config default.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { buildDecumulationDefaults } from "@/server/routers/projection/_shared";
import {
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";

const NULL_STRATEGY_PARAMS = {
  gkUpperGuardrail: null,
  gkLowerGuardrail: null,
  gkIncreasePct: null,
  gkDecreasePct: null,
  gkSkipInflationAfterLoss: true,
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

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...NULL_STRATEGY_PARAMS,
    withdrawalRate: "0.04",
    withdrawalStrategy: "fixed",
    ...overrides,
  } as Parameters<typeof buildDecumulationDefaults>[0];
}

const NO_CLIENT = { withdrawalTaxPreference: {} };
const RATES = {
  traditional: 0.22,
  roth: 0,
  hsa: 0,
  brokerage: 0.15,
  taxDataYear: 2025,
} as Parameters<typeof buildDecumulationDefaults>[2];

describe("buildDecumulationDefaults — withdrawalOrder / withdrawalSplits resolution", () => {
  it("falls back to the config default when neither client nor settings supply one", () => {
    const out = buildDecumulationDefaults(makeSettings(), NO_CLIENT, RATES);
    expect(out.withdrawalOrder).toEqual(getDefaultDecumulationOrder());
    expect(out.withdrawalSplits).toEqual(DEFAULT_WITHDRAWAL_SPLITS);
  });

  it("uses the persisted settings value when the client omits it", () => {
    const persistedOrder = ["brokerage", "401k", "403b", "ira", "hsa"];
    const persistedSplits = {
      "401k": 0.5,
      "403b": 0,
      ira: 0.2,
      hsa: 0,
      brokerage: 0.3,
    };
    const out = buildDecumulationDefaults(
      makeSettings({
        withdrawalOrder: persistedOrder,
        withdrawalSplits: persistedSplits,
      }),
      NO_CLIENT,
      RATES,
    );
    expect(out.withdrawalOrder).toEqual(persistedOrder);
    expect(out.withdrawalSplits).toEqual(persistedSplits);
  });

  it("lets a client override (touched session) win over the persisted value", () => {
    const persistedOrder = ["brokerage", "401k", "403b", "ira", "hsa"];
    const clientOrder = ["hsa", "ira", "403b", "401k", "brokerage"];
    const out = buildDecumulationDefaults(
      makeSettings({ withdrawalOrder: persistedOrder }),
      { ...NO_CLIENT, withdrawalOrder: clientOrder },
      RATES,
    );
    expect(out.withdrawalOrder).toEqual(clientOrder);
  });

  it("treats a NULL settings column as absent (config default, not a crash)", () => {
    const out = buildDecumulationDefaults(
      makeSettings({ withdrawalOrder: null, withdrawalSplits: null }),
      NO_CLIENT,
      RATES,
    );
    expect(out.withdrawalOrder).toEqual(getDefaultDecumulationOrder());
    expect(out.withdrawalSplits).toEqual(DEFAULT_WITHDRAWAL_SPLITS);
  });
});
