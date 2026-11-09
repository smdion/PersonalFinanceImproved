/**
 * `prepareEngineInput` (server/routers/projection/engine-input.ts): the one
 * engine-input assembly the projection procedures share. Guards the
 * cross-path rule (TESTING keep rule 2): every procedure runs the payload's
 * base with `buildDecumulationDefaults` and the "Changes by year" a caller
 * sent, or the household's saved rows when it sent none, in that key order.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";
import { shippedTaxTables } from "../helpers/tax-data";
import { buildDecumulationDefaults } from "@/server/routers/projection/_shared";
import { prepareEngineInput } from "@/server/routers/projection/engine-input";

const SETTINGS = {
  withdrawalRate: "0.04",
  withdrawalStrategy: "fixed",
  withdrawalRoutingMode: "waterfall",
} as Parameters<typeof buildDecumulationDefaults>[0];
const RATES: Parameters<typeof buildDecumulationDefaults>[2] = {
  traditionalFallbackRate: 0.22,
  roth: 0,
  hsa: 0,
  brokerage: 0.15,
  taxDataYear: 2026,
  ...shippedTaxTables(2026),
};
const NO_CLIENT = { withdrawalTaxPreference: {} };
const SAVED = [{ year: 2031, contributionRate: 0 }];

describe("prepareEngineInput", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  const payload = {
    settings: SETTINGS,
    distributionTaxRates: RATES,
    baseEngineInput: { currentAge: 40, profileSwitches: undefined },
  };

  beforeAll(async () => {
    ctx = await createTestCaller();
    await ctx.caller.retirement.projectionOverrides.save({
      overrideType: "accumulation",
      overrides: SAVED,
    });
  });
  afterAll(() => ctx.cleanup());

  it("spreads the base, then the resolved defaults, then both override lists", async () => {
    const out = await prepareEngineInput(ctx.rawDb, payload, {
      decumulationDefaults: NO_CLIENT,
    });
    expect(Object.keys(out)).toEqual([
      "currentAge",
      "profileSwitches",
      "decumulationDefaults",
      "accumulationOverrides",
      "decumulationOverrides",
    ]);
    expect(out.decumulationDefaults).toEqual(
      buildDecumulationDefaults(SETTINGS, NO_CLIENT, RATES),
    );
  });

  it("reads the saved rows when the caller sends none", async () => {
    const out = await prepareEngineInput(ctx.rawDb, payload, {
      decumulationDefaults: NO_CLIENT,
    });
    expect(out.accumulationOverrides).toEqual(SAVED);
    expect(out.decumulationOverrides).toEqual([]);
  });

  it("uses the caller's lists and its client defaults over the saved ones", async () => {
    const sent = [{ year: 2035, contributionRate: 0.1 }];
    const client = {
      withdrawalRoutingMode: "percentage" as const,
      withdrawalTaxPreference: {},
    };
    const out = await prepareEngineInput(ctx.rawDb, payload, {
      decumulationDefaults: client,
      accumulationOverrides: sent,
    });
    expect(out.accumulationOverrides).toEqual(sent);
    expect(out.decumulationDefaults.withdrawalRoutingMode).toBe("percentage");
  });
});
