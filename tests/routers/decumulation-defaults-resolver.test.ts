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
import { shippedTaxTables } from "../helpers/tax-data";
import { buildDecumulationDefaults } from "@/server/services/projection/projection-run";
import { resolveDecumulationConfig } from "@/lib/pure/engine/override-resolution";
import {
  decumulationDefaultsInputSchema,
  decumulationOverrideArraySchema,
  storedWithdrawalSplitsSchema,
} from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";
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
    withdrawalRoutingMode: "bracket_filling",
    ...overrides,
  } as Parameters<typeof buildDecumulationDefaults>[0];
}

const NO_CLIENT = { withdrawalTaxPreference: {} };
const RATES: Parameters<typeof buildDecumulationDefaults>[2] = {
  traditionalFallbackRate: 0.22,
  roth: 0,
  hsa: 0,
  brokerage: 0.15,
  taxDataYear: 2026,
  ...shippedTaxTables(2026),
};

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
    const clientOrder: AccountCategory[] = [
      "hsa",
      "ira",
      "403b",
      "401k",
      "brokerage",
    ];
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

describe("the withdrawal settings' one schema", () => {
  it("applies a sent avoidPenalizedWithdrawals: the defaults and a year's override", () => {
    const client = decumulationDefaultsInputSchema.parse({
      avoidPenalizedWithdrawals: false,
    });
    const defaults = buildDecumulationDefaults(makeSettings(), client, RATES);
    expect(
      resolveDecumulationConfig(2040, defaults, []).avoidPenalizedWithdrawals,
    ).toBe(false);

    const overrides = decumulationOverrideArraySchema.parse([
      { year: 2045, avoidPenalizedWithdrawals: true },
    ]);
    expect(
      resolveDecumulationConfig(2044, defaults, overrides)
        .avoidPenalizedWithdrawals,
    ).toBe(false);
    expect(
      resolveDecumulationConfig(2045, defaults, overrides)
        .avoidPenalizedWithdrawals,
    ).toBe(true);
  });

  it("leaves avoidPenalizedWithdrawals at its default (avoid) when not sent", () => {
    const defaults = buildDecumulationDefaults(
      makeSettings(),
      NO_CLIENT,
      RATES,
    );
    expect(
      resolveDecumulationConfig(2040, defaults, []).avoidPenalizedWithdrawals,
    ).toBe(true);
  });

  it("drops a tax-preference key that names no account category, in both inputs, never refusing it", () => {
    const client = decumulationDefaultsInputSchema.parse({
      withdrawalTaxPreference: { "401k": "roth", "401(k)": "traditional" },
    });
    expect(client.withdrawalTaxPreference).toEqual({ "401k": "roth" });
    const [override] = decumulationOverrideArraySchema.parse([
      {
        year: 2040,
        withdrawalTaxPreference: { ira: "traditional", x: "roth" },
      },
    ]);
    expect(override!.withdrawalTaxPreference).toEqual({ ira: "traditional" });
  });

  it("takes partial splits, a category left out at 0%, sent or saved", () => {
    const client = decumulationDefaultsInputSchema.parse({
      withdrawalSplits: { "401k": 0.6, brokerage: 0.4 },
    });
    expect(client.withdrawalSplits).toEqual({
      "401k": 0.6,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0.4,
    });
    expect(
      storedWithdrawalSplitsSchema.parse({ ira: 0.5, brokerage: 0.5 }),
    ).toEqual({ "401k": 0, "403b": 0, ira: 0.5, hsa: 0, brokerage: 0.5 });
  });
});
