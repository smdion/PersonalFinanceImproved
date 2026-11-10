/**
 * `prepareEngineInput` (server/services/projection/projection-run.ts): the one
 * engine-input assembly the projection procedures share. Guards the
 * cross-path rule (TESTING keep rule 2): every procedure runs the payload's
 * base with `buildDecumulationDefaults` and the "Changes by year" a caller
 * sent, or the household's saved rows when it sent none, in that key order.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller } from "./setup";
import { shippedTaxTables } from "../helpers/tax-data";
import {
  buildDecumulationDefaults,
  prepareEngineInput,
  resolveProjectionOverrides,
} from "@/server/services/projection/projection-run";

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

describe('the saved "Changes by year" with per-category fields', () => {
  it("applies a saved set that sets only some categories (a tax split, a withdrawal tax preference)", async () => {
    const ctx = await createTestCaller();
    try {
      const accumulation = [
        { year: 2031, taxSplits: { "401k": 0.5 }, accountCaps: { ira: 3000 } },
      ];
      const decumulation = [
        {
          year: 2045,
          withdrawalTaxPreference: { "401k": "roth" },
          withdrawalSplits: { brokerage: 1 },
          withdrawalAccountCaps: { "401k": 40000 },
        },
      ];
      await ctx.caller.retirement.projectionOverrides.save({
        overrideType: "accumulation",
        overrides: accumulation,
      });
      await ctx.caller.retirement.projectionOverrides.save({
        overrideType: "decumulation",
        overrides: decumulation,
      });
      const out = await prepareEngineInput(
        ctx.rawDb,
        {
          settings: SETTINGS,
          distributionTaxRates: RATES,
          baseEngineInput: {},
        },
        { decumulationDefaults: NO_CLIENT },
      );
      expect(out.accumulationOverrides).toEqual(accumulation);
      expect(out.decumulationOverrides).toEqual(decumulation);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("resolveProjectionOverrides", () => {
  it("drops a saved set its schema refuses, with one warning (owner W4)", async () => {
    const ctx = await createTestCaller();
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Stored by an older version: the save path refuses this set now.
      ctx.db
        .insert(schema.projectionOverrides)
        .values({
          overrideType: "decumulation",
          overrides: [{ year: "2040", withdrawalRoutingMode: "waterfall" }],
        })
        .run();
      await ctx.caller.retirement.projectionOverrides.save({
        overrideType: "accumulation",
        overrides: SAVED,
      });
      const first = await resolveProjectionOverrides(ctx.rawDb, {});
      await resolveProjectionOverrides(ctx.rawDb, {});
      expect(first).toEqual({
        accumulationOverrides: SAVED,
        decumulationOverrides: [],
      });
      const warnings = logged.mock.calls
        .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
        .filter((e) => e.event === "stored_value_unexpected_shape");
      expect(warnings).toEqual([
        expect.objectContaining({
          source: "projection_overrides.decumulation",
        }),
      ]);
    } finally {
      logged.mockRestore();
      ctx.cleanup();
    }
  });
});

describe("projectionOverrides.save", () => {
  it("refuses a set its kind's shape refuses, and stores a set as sent", async () => {
    const ctx = await createTestCaller();
    try {
      const save = ctx.caller.retirement.projectionOverrides.save;
      await expect(
        save({
          overrideType: "decumulation",
          overrides: [{ year: "2040", withdrawalRoutingMode: "waterfall" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        save({
          overrideType: "brokerage",
          overrides: [{ id: "a", year: 2030, amount: "500" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // A key the engine doesn't read (the editor's personName) is kept.
      const sent = [
        { year: 2030, personName: "Invented", contributionRate: 0.1 },
      ];
      await save({ overrideType: "accumulation", overrides: sent });
      expect(
        await ctx.caller.retirement.projectionOverrides.get({
          overrideType: "accumulation",
        }),
      ).toEqual(sent);
      const events = [
        {
          id: "e1",
          year: "2030",
          amount: "-1000",
          targetAccount: "brokerage",
          targetAccountName: "",
          targetOwnerName: "",
          taxType: "",
          label: "Invented withdrawal",
        },
      ];
      await save({ overrideType: "brokerage", overrides: events });
      expect(
        await ctx.caller.retirement.projectionOverrides.get({
          overrideType: "brokerage",
        }),
      ).toEqual(events);
    } finally {
      ctx.cleanup();
    }
  });
});
