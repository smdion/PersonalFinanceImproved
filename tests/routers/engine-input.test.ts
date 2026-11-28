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
  rothBracketOverlay: true,
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

  it("passes the Brokerage page's planned withdrawals to the engine", async () => {
    const brokerageWithdrawals = [
      { id: "w", year: 2030, amount: 20_000, label: "Invented" },
    ];
    const out = await prepareEngineInput(ctx.rawDb, payload, {
      decumulationDefaults: NO_CLIENT,
      brokerageWithdrawals,
    });
    expect(out.brokerageWithdrawals).toEqual(brokerageWithdrawals);
  });
});

describe("buildDecumulationDefaults, a saved routing mode this version doesn't know", () => {
  it("runs it as Bracket Filling, as every page shows, with a setup note", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const notes: string[] = [];
    const out = buildDecumulationDefaults(
      { ...SETTINGS, withdrawalRoutingMode: "glide_path" },
      NO_CLIENT,
      RATES,
      notes,
    );
    expect(out.withdrawalRoutingMode).toBe("bracket_filling");
    expect(notes).toEqual([expect.stringMatching(/"glide_path"/)]);

    // A mode the page sends (its Configure toggle) runs, with no note.
    const sent: string[] = [];
    const withClient = buildDecumulationDefaults(
      { ...SETTINGS, withdrawalRoutingMode: "glide_path" },
      { ...NO_CLIENT, withdrawalRoutingMode: "waterfall" },
      RATES,
      sent,
    );
    expect(withClient.withdrawalRoutingMode).toBe("waterfall");
    expect(sent).toEqual([]);
    vi.restoreAllMocks();
  });

  it("still uses the saved order and splits beside it", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const out = buildDecumulationDefaults(
        {
          ...SETTINGS,
          withdrawalRoutingMode: "glide_path",
          withdrawalOrder: ["ira", "401k"],
          withdrawalSplits: { ira: 0.25, "401k": 0.75 },
        },
        NO_CLIENT,
        RATES,
      );
      expect(out.withdrawalOrder).toEqual(["ira", "401k"]);
      expect(out.withdrawalSplits).toMatchObject({ ira: 0.25, "401k": 0.75 });
    } finally {
      vi.restoreAllMocks();
    }
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

describe("resolveProjectionOverrides, one refused part of a saved set", () => {
  it("leaves out only the refused field, lump sum or row, names each, and runs the rest", async () => {
    const ctx = await createTestCaller();
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // A newer Ledgr's mode, a preference value, a lump sum with a text
      // amount, an element that isn't a row and a row whose year is text.
      const stored = [
        {
          year: 2040,
          withdrawalRoutingMode: "glide",
          rothConversionTarget: 0.1,
        },
        { year: 2041, withdrawalTaxPreference: { "401k": "after_tax" } },
        {
          year: 2042,
          lumpSums: [
            { amount: "5000", targetAccount: "401k" },
            { amount: 1000, targetAccount: "ira" },
          ],
        },
        "2043",
        { year: "2044", rothBracketTarget: 0.22 },
        { year: 2045, rothBracketTarget: 0.12 },
      ];
      ctx.db
        .insert(schema.projectionOverrides)
        .values({
          overrideType: "decumulation",
          // The column's type holds rows only; this set is as stored.
          overrides: JSON.parse(JSON.stringify(stored)),
        })
        .run();
      const notes: string[] = [];
      const read = await resolveProjectionOverrides(ctx.rawDb, {}, notes);
      expect(read.decumulationOverrides).toEqual([
        { year: 2040, rothConversionTarget: 0.1 },
        { year: 2041 },
        { year: 2042, lumpSums: [{ amount: 1000, targetAccount: "ira" }] },
        { year: 2045, rothBracketTarget: 0.12 },
      ]);
      expect(notes).toEqual([
        expect.stringMatching(/2040.*withdrawal routing mode.*"glide"/),
        expect.stringMatching(/2041.*withdrawal tax preference/),
        expect.stringMatching(
          /lump sum of \$5,000 in Changes by year for 2042/,
        ),
        expect.stringMatching(/"2043"/),
        expect.stringMatching(/"2044"/),
      ]);
    } finally {
      vi.restoreAllMocks();
      ctx.cleanup();
    }
  });
});

describe("resolveProjectionOverrides, one refused part of a saved accumulation set", () => {
  it("leaves out a refused mode beside valid splits, and the whole row of a refused reset", async () => {
    const ctx = await createTestCaller();
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      ctx.db
        .insert(schema.projectionOverrides)
        .values({
          overrideType: "accumulation",
          overrides: [
            { year: 2031, routingMode: "x", accountSplits: { "401k": 1 } },
            // A reset row reverts and ignores the rest: never half of it.
            { year: 2032, reset: "yes", contributionRate: 0.1 },
            { year: 2033, contributionRate: 0.2 },
          ],
        })
        .run();
      const notes: string[] = [];
      const read = await resolveProjectionOverrides(ctx.rawDb, {}, notes);
      expect(read.accumulationOverrides).toEqual([
        { year: 2031, accountSplits: { "401k": 1 } },
        { year: 2033, contributionRate: 0.2 },
      ]);
      expect(notes).toEqual([
        expect.stringMatching(/2031.*routing mode.*"x"/),
        expect.stringMatching(/"reset":"yes".*its year, or its reset/),
      ]);
    } finally {
      vi.restoreAllMocks();
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
