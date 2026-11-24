/**
 * A stored account type this version doesn't know (saved by a newer Ledgr,
 * say): the projection and Tax Buckets leave that money out and say so,
 * naming the row and its amount. A saved setting naming one (the withdrawal
 * order or splits, a "Changes by year" row) drops it and says so; the
 * editors' saves keep it (owner Q-unknown-category-erase (b)).
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedBudgetItem,
  seedBudgetProfile,
  seedContributionAccount,
  seedContributionProfile,
  seedPerformanceAccount,
  seedStandardDataset,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema-sqlite";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import { openingTotals } from "@/lib/pure/engine/opening-state";
import { prepareEngineInput } from "@/server/services/projection/projection-run";
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));
// The strategy comparison's Simulations run in this thread, 5 trials each:
// these tests read its notes, never a rate (projection-coverage's pattern).
vi.mock("@/server/services/simulation/monte-carlo-worker-client", async () => {
  const { calculateMonteCarlo } =
    await import("@/lib/pure/simulation/monte-carlo");
  return {
    runMonteCarloOffThread: async (
      input: Parameters<typeof calculateMonteCarlo>[0],
    ) => calculateMonteCarlo({ ...input, numTrials: 5 }),
    getMonteCarloProgress: () => null,
  };
});

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

/** The standard household (a $100,000 401k) with retirement settings. */
function seedHousehold(db: BetterSQLite3Database<typeof schema>) {
  const ids = seedStandardDataset(db);
  db.insert(schema.retirementSettings)
    .values({
      personId: ids.personId,
      retirementAge: 65,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      filingStatus: "MFJ",
    })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  return ids;
}

/** A performance account of a type this version doesn't know. */
function seedUnknownAccount(
  db: BetterSQLite3Database<typeof schema>,
  personId: number,
) {
  return seedPerformanceAccount(db, {
    accountType: "future_type",
    accountLabel: "Future Plan",
    displayName: "Future Plan",
    ownerPersonId: personId,
  });
}

/** The notes beside the Retirement page's strategy comparison. */
async function comparisonNotes(ctx: Ctx) {
  const comparison = await ctx.caller.projection.computeStrategyComparison();
  const notes = "notes" in comparison ? comparison.notes : undefined;
  if (!notes) throw new Error("no notes in the comparison");
  return notes;
}

/** The notes beside the Relocation tool's projection, between two budgets. */
async function relocationNotes(ctx: Ctx) {
  const currentProfileId = await seedBudgetProfile(ctx.db, "Current City");
  seedBudgetItem(ctx.db, currentProfileId, { amounts: [2000] });
  const relocationProfileId = await seedBudgetProfile(ctx.db, "New City");
  seedBudgetItem(ctx.db, relocationProfileId, { amounts: [1500] });
  const result = await ctx.caller.projection.computeRelocationFiProjection({
    currentProfileId,
    currentBudgetColumn: 0,
    relocationProfileId,
    relocationBudgetColumn: 0,
  });
  const notes = result && "notes" in result ? result.notes : undefined;
  if (!notes) throw new Error("no notes in the relocation projection");
  return notes;
}

const ROW_NOTE =
  'Future Plan is saved as account type "future_type", which this version doesn\'t know, so the projection and Tax Buckets leave out its $40,000. Update Ledgr or change its account type.';

describe("a snapshot row of an account type this version doesn't know", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const { personId, snapId } = seedHousehold(ctx.db);
    ctx.db
      .insert(schema.portfolioAccounts)
      .values({
        snapshotId: snapId,
        performanceAccountId: seedUnknownAccount(ctx.db, personId),
        amount: "40000",
        taxType: "preTax",
        institution: "Fidelity",
        accountType: "future_type",
        ownerPersonId: personId,
        parentCategory: "Retirement",
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("the projection leaves it out and says so", async () => {
    const data = await fetchRetirementData(ctx.rawDb);
    const payload = await buildEnginePayload(ctx.rawDb, data, {
      asOf: new Date(),
    });
    expect(payload!.portfolioTotal).toBe(100000);
    const { balances } = openingTotals(
      payload!.baseEngineInput.individualAccounts,
    );
    expect(balances.preTax).toBe(100000);
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings).toContain(ROW_NOTE);
  });

  it("the strategy comparison names it too", async () => {
    expect(await comparisonNotes(ctx)).toEqual([ROW_NOTE]);
  });

  it("the Relocation tool names it too", async () => {
    expect(await relocationNotes(ctx)).toEqual([ROW_NOTE]);
  });

  it("Tax Buckets leaves it out and names it", async () => {
    const response = await ctx.caller.taxBuckets.computeBreakdown();
    expect(response.portfolioByTaxType.preTax).toBe(100000);
    expect(response.accounts.map((a) => a.balance)).toEqual([100000]);
    expect(response.unknownTypeNotes).toEqual([ROW_NOTE]);
  });
});

describe("a contribution account of an account type this version doesn't know", () => {
  let ctx: Ctx;
  let contributionProfileId: number;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const { personId, jobId, perfAcctId } = seedHousehold(ctx.db);
    const known = seedContributionAccount(ctx.db, {
      personId,
      jobId,
      performanceAccountId: perfAcctId,
    });
    const unknown = seedContributionAccount(ctx.db, {
      accountType: "future_type",
      personId,
      jobId,
      performanceAccountId: seedUnknownAccount(ctx.db, personId),
    });
    const tenPercent = {
      contributionValue: "0.10",
      contributionMethod: "percent_of_salary",
    };
    contributionProfileId = seedContributionProfile(ctx.db, {
      contributionActiveFields: {
        contributionAccounts: {
          [String(known)]: tenPercent,
          [String(unknown)]: tenPercent,
        },
      },
    });
  });
  afterAll(() => ctx.cleanup());

  it("the projection runs on the known accounts and says so", async () => {
    const data = await fetchRetirementData(ctx.rawDb, {
      contributionProfileId,
    });
    const payload = await buildEnginePayload(ctx.rawDb, data, {
      asOf: new Date(),
      contributionProfileId,
    });
    expect(payload!.contributionSpecs.map((s) => s.category)).toEqual(["401k"]);
    const response = await ctx.caller.projection.computeProjection({
      selection: { contribution: contributionProfileId },
    });
    expect(response.result!.warnings).toContain(
      'Future Plan is saved as account type "future_type", which this version doesn\'t know, so the projection leaves out its contributions. Update Ledgr or change its account type.',
    );
  });
});

describe("saved settings naming an account type this version doesn't know", () => {
  let ctx: Ctx;
  const left = (setting: string) =>
    `Account type "future_type", which this version doesn't know, is left out of ${setting}. Update Ledgr or change that setting.`;

  beforeAll(async () => {
    ctx = await createTestCaller();
    seedHousehold(ctx.db);
    ctx.db
      .update(schema.retirementSettings)
      .set({
        // Waterfall in the household's own order (the overlay would draw
        // in the default order).
        withdrawalRoutingMode: "waterfall",
        rothBracketOverlay: false,
        withdrawalOrder: ["future_type", "401k", "brokerage"],
        withdrawalSplits: { future_type: 0.3, "401k": 0.7 },
      })
      .run();
    // Written outside the app (the save path refuses these sets).
    ctx.db
      .insert(schema.projectionOverrides)
      .values([
        {
          overrideType: "accumulation",
          overrides: [
            {
              year: 2040,
              accountOrder: ["future_type", "401k"],
              accountSplits: { future_type: 0.5, "401k": 0.5 },
              // Two equal lump sums to it: both are counted in the note.
              lumpSums: [
                { amount: 5000, targetAccount: "future_type" },
                { amount: 3000, targetAccount: "401k" },
                { amount: 5000, targetAccount: "future_type" },
              ],
            },
          ],
        },
        {
          overrideType: "decumulation",
          overrides: [
            {
              year: 2060,
              // Emptied by the drop: the row sets no order.
              withdrawalOrder: ["future_type"],
              withdrawalSplits: { future_type: 0.5, "401k": 0.5 },
              withdrawalAccountCaps: { future_type: 1000 },
              withdrawalTaxPreference: { future_type: "roth", "401k": "roth" },
              lumpSums: [{ amount: 1234.56, targetAccount: "future_type" }],
            },
          ],
        },
      ])
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("the engine input drops it and keeps the rest", async () => {
    const data = await fetchRetirementData(ctx.rawDb);
    const payload = await buildEnginePayload(ctx.rawDb, data, {
      asOf: new Date(),
    });
    const input = await prepareEngineInput(ctx.rawDb, payload!, {
      decumulationDefaults: { withdrawalTaxPreference: {} },
    });
    expect(input.decumulationDefaults.withdrawalOrder).toEqual([
      "401k",
      "brokerage",
    ]);
    // Read as stored, as before; the router scales the 70% left to the
    // year's need (splitShares).
    expect(input.decumulationDefaults.withdrawalSplits).toEqual({
      "401k": 0.7,
    });
    expect(input.accumulationOverrides).toEqual([
      {
        year: 2040,
        accountOrder: ["401k"],
        accountSplits: { "401k": 0.5 },
        lumpSums: [{ amount: 3000, targetAccount: "401k" }],
      },
    ]);
    expect(input.decumulationOverrides).toEqual([
      {
        year: 2060,
        withdrawalSplits: { "401k": 0.5 },
        withdrawalAccountCaps: {},
        withdrawalTaxPreference: { "401k": "roth" },
        lumpSums: [],
      },
    ]);
  });

  it("the projection runs and names each one", async () => {
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings).toEqual(
      expect.arrayContaining([
        left("the saved withdrawal order"),
        left("the saved withdrawal splits"),
        left("Changes by year for 2040"),
        '2 lump sums totalling $10,000 in Changes by year for 2040 go to account type "future_type", which this version doesn\'t know, so the projection leaves them out. Update Ledgr or change those lump sums.',
        left("Changes by year for 2060"),
        'A lump sum of $1,235 in Changes by year for 2060 goes to account type "future_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
      ]),
    );
    // The Retirement page shows the saved routing as the projection reads it.
    if (!("settings" in response)) throw new Error("no settings");
    expect(response.settings.withdrawalOrder).toEqual(["401k", "brokerage"]);
    expect(response.settings.withdrawalSplits).toEqual({ "401k": 0.7 });
  });

  /** Each saved setting's note is there, and no note twice. */
  function expectEachNamedOnce(notes: string[]) {
    expect(notes).toEqual(
      expect.arrayContaining([
        left("the saved withdrawal order"),
        left("the saved withdrawal splits"),
        left("Changes by year for 2040"),
        left("Changes by year for 2060"),
      ]),
    );
    expect(new Set(notes).size).toBe(notes.length);
  }

  it("the strategy comparison names each one, once", async () => {
    expectEachNamedOnce(await comparisonNotes(ctx));
  });

  it("the Relocation tool names each one, once", async () => {
    expectEachNamedOnce(await relocationNotes(ctx));
  });

  it("percentage routing draws the year's need from the splits left", async () => {
    const response = await ctx.caller.projection.computeProjection({
      decumulationDefaults: {
        withdrawalRoutingMode: "percentage",
        withdrawalTaxPreference: {},
      },
    });
    expect(response.result!.warnings).toContain(
      left("the saved withdrawal splits"),
    );
    // Before the 2060 row's own splits, each retired year says so.
    const retiredYears = response.result!.projectionByYear.filter(
      (y) => y.phase === "decumulation" && y.year < 2060,
    );
    expect(retiredYears.length).toBeGreaterThan(0);
    for (const y of retiredYears)
      expect(y.warnings).toContainEqual(
        expect.stringContaining("Withdrawal splits sum to 70%, not 100%"),
      );
  });

  it("a withdrawal order the page sends wins, so the saved one goes unnamed", async () => {
    const response = await ctx.caller.projection.computeProjection({
      decumulationDefaults: {
        withdrawalOrder: ["401k", "brokerage"],
        withdrawalTaxPreference: {},
      },
    });
    expect(response.result!.warnings).not.toContain(
      left("the saved withdrawal order"),
    );
    expect(response.result!.warnings).toContain(
      left("the saved withdrawal splits"),
    );
  });
});

describe("a saved lump sum to a parent category this version doesn't know", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await createTestCaller();
    seedHousehold(ctx.db);
    // Written outside the app (the save path refuses this set).
    ctx.db
      .insert(schema.projectionOverrides)
      .values({
        overrideType: "accumulation",
        overrides: [
          {
            year: 2040,
            accountOrder: ["401k"],
            lumpSums: [
              {
                amount: 4000,
                targetAccount: "401k",
                targetParentCategory: "Future Money",
              },
              { amount: 3000, targetAccount: "401k" },
            ],
          },
        ],
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("the engine input leaves that lump sum out and keeps the rest of the set", async () => {
    const data = await fetchRetirementData(ctx.rawDb);
    const payload = await buildEnginePayload(ctx.rawDb, data, {
      asOf: new Date(),
    });
    const input = await prepareEngineInput(ctx.rawDb, payload!, {
      decumulationDefaults: { withdrawalTaxPreference: {} },
    });
    expect(input.accumulationOverrides).toEqual([
      {
        year: 2040,
        accountOrder: ["401k"],
        lumpSums: [{ amount: 3000, targetAccount: "401k" }],
      },
    ]);
  });

  it("the projection names the year, the parent category and the amount", async () => {
    const response = await ctx.caller.projection.computeProjection({});
    expect(response.result!.warnings).toContain(
      'A lump sum of $4,000 in Changes by year for 2040 goes to parent category "Future Money", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
    );
  });
});

describe("a saved savings order naming only an account type this version doesn't know", () => {
  /** The household's projection by year, with `overrides` saved first. */
  async function projectionByYear(overrides?: Record<string, unknown>[]) {
    const ctx = await createTestCaller();
    try {
      seedHousehold(ctx.db);
      if (overrides)
        ctx.db
          .insert(schema.projectionOverrides)
          .values({ overrideType: "accumulation", overrides })
          .run();
      const { result } = await ctx.caller.projection.computeProjection({});
      return result!;
    } finally {
      ctx.cleanup();
    }
  }

  it("routes contributions as with no row, and says so", async () => {
    // No contribution accounts: the savings order routes each year's saving.
    const without = await projectionByYear();
    const withRow = await projectionByYear([
      { year: 2030, accountOrder: ["future_type"] },
    ]);
    expect(withRow.projectionByYear).toEqual(without.projectionByYear);
    expect(withRow.warnings).toContain(
      `Account type "future_type", which this version doesn't know, is left out of Changes by year for 2030. Update Ledgr or change that setting.`,
    );
  });
});

describe("the saved sets the editors save, naming an account type this version doesn't know", () => {
  let ctx: Ctx;
  // A newer Ledgr's row (the save path refuses it): an order entry, a split
  // and a lump sum for a type this version doesn't know, beside known ones.
  const newerRow = {
    year: 2030,
    accountOrder: ["future_type", "401k"],
    accountSplits: { future_type: 0.5, "401k": 0.5 },
    lumpSums: [
      { amount: 5000, targetAccount: "future_type" },
      { amount: 3000, targetAccount: "401k" },
    ],
  };
  const event = (id: string, targetAccount: string) => ({
    id,
    year: "2031",
    amount: "2500",
    targetAccount,
    targetAccountName: "",
    targetOwnerName: "",
    taxType: "",
    label: "",
  });
  const unknownEvent = event("a", "future_type");
  const known2035 = { year: 2035, contributionRate: 0.1 };

  /** One kind's set as stored. */
  const stored = (overrideType: string) =>
    ctx.db
      .select()
      .from(schema.projectionOverrides)
      .all()
      .find((r) => r.overrideType === overrideType)?.overrides;
  const store = (overrideType: string, overrides: Record<string, unknown>[]) =>
    ctx.db
      .insert(schema.projectionOverrides)
      .values({ overrideType, overrides })
      .onConflictDoUpdate({
        target: schema.projectionOverrides.overrideType,
        set: { overrides },
      })
      .run();

  beforeAll(async () => {
    ctx = await createTestCaller();
    seedHousehold(ctx.db);
  });
  afterAll(() => ctx.cleanup());

  it("an edit to another year keeps the stored entries for it", async () => {
    store("accumulation", [newerRow, known2035]);
    // The set as this version can send it: without the unknown type.
    const edited = [
      {
        year: 2030,
        accountOrder: ["401k"],
        accountSplits: { "401k": 0.5 },
        lumpSums: [{ amount: 3000, targetAccount: "401k" }],
      },
      { year: 2035, contributionRate: 0.2 },
    ];
    const saved = await ctx.caller.retirement.projectionOverrides.save({
      overrideType: "accumulation",
      overrides: edited,
    });
    // The stored row, as before, with the notes beside it.
    expect(saved).toMatchObject({
      overrideType: "accumulation",
      overrides: stored("accumulation"),
      unknownTypeNotes: [],
    });
    expect(stored("accumulation")).toEqual([
      {
        ...newerRow,
        // The lump sum to the unknown type goes back after the row's own.
        lumpSums: [
          { amount: 3000, targetAccount: "401k" },
          { amount: 5000, targetAccount: "future_type" },
        ],
      },
      { year: 2035, contributionRate: 0.2 },
    ]);
  });

  it("deleting their row drops them, and the save names what went", async () => {
    store("accumulation", [newerRow, known2035]);
    const saved = await ctx.caller.retirement.projectionOverrides.save({
      overrideType: "accumulation",
      overrides: [known2035],
    });
    expect(saved).toMatchObject({
      overrideType: "accumulation",
      overrides: [known2035],
      unknownTypeNotes: [
        'Deleting Changes by year for 2030 also deleted what it set for account type "future_type", which this version doesn\'t know.',
        'Deleting Changes by year for 2030 also deleted its lump sum of $5,000 to account type "future_type", which this version doesn\'t know.',
      ],
    });
    expect(stored("accumulation")).toEqual([known2035]);
  });

  it("the Brokerage page's save and clear keep an event to such a type", async () => {
    store("brokerage", [unknownEvent, event("b", "brokerage")]);
    const { save, clear } = ctx.caller.retirement.projectionOverrides;
    await save({
      overrideType: "brokerage",
      overrides: [event("c", "brokerage")],
    });
    expect(stored("brokerage")).toEqual([
      event("c", "brokerage"),
      unknownEvent,
    ]);
    expect(await clear({ overrideType: "brokerage" })).toEqual({
      unknownTypeNotes: [],
    });
    expect(stored("brokerage")).toEqual([unknownEvent]);
  });

  it("clearing a Changes by year set with such entries names what went", async () => {
    store("decumulation", [
      { year: 2060, withdrawalOrder: ["future_type", "401k"] },
    ]);
    const cleared = await ctx.caller.retirement.projectionOverrides.clear({
      overrideType: "decumulation",
    });
    expect(cleared.unknownTypeNotes).toEqual([
      'Deleting Changes by year for 2060 also deleted what it set for account type "future_type", which this version doesn\'t know.',
    ]);
    expect(stored("decumulation")).toBeUndefined();
  });

  it("saving an empty set stores it, as before, with the entries kept", async () => {
    store("decumulation", [
      { year: 2060, withdrawalOrder: ["future_type", "401k"] },
      { year: 2061, withdrawalOrder: ["401k"] },
    ]);
    const saved = await ctx.caller.retirement.projectionOverrides.save({
      overrideType: "decumulation",
      overrides: [],
    });
    expect(saved).toMatchObject({
      overrideType: "decumulation",
      overrides: [],
    });
    expect(saved.unknownTypeNotes).toHaveLength(1);
    expect(stored("decumulation")).toEqual([]);
  });
});
