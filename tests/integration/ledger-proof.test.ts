/**
 * The ledger proof: on every run below, the three tracks (A, the tax
 * buckets; B, the categories; C, the account parts) agree to the cent at the
 * seed and at every settled point (D1: A against B at the seed; D2: B against
 * its parts, except at a point whose flow moves only the parts; D3: a
 * category's basis against its parts'), each year-end correction writes
 * nothing (the reconcile, the surplus handoff, the basis sync), every draw
 * and every conversion's debit and tax land on parts, no money sits in a
 * slice or basis category without parts, every run holds a ledger, and the
 * overwrite of A at `settle` stays within a cent or two a bucket. The
 * counters are `ledger-proof/counters.ts`,
 * wrapped around the engine's own functions here; a failure names its first
 * site.
 *
 * The runs: the 17 baseline households and the conversion variant e2e-dc,
 * each with its projection (which must equal its pinned file, so the
 * wrappers change no figure) and its Simple-mode Simulation at the
 * baseline's 10 trials; a 100-trial Simulation of ws-h4; the engine's
 * fast-check generators at a fixed seed; the named inputs whose specs pay
 * their own account's part; and the synthetic second overflow-target
 * household, judged on its ledger (D2, D3) only. Exactly one account type is
 * an overflow target (tests/config/account-type-config.test.ts).
 */
// First: the SQLite harness's mocks.
import "../routers/setup-mocks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import fc from "fast-check";

/** Trials per Simulation: the baseline's 10, raised for the one long run. */
const simulation = vi.hoisted(() => ({ trials: 10 }));
vi.mock("@/server/services/simulation/monte-carlo-worker-client", async () => {
  const { calculateMonteCarlo } =
    await import("@/lib/pure/simulation/monte-carlo");
  return {
    runMonteCarloOffThread: async (
      input: Parameters<typeof calculateMonteCarlo>[0],
    ) =>
      calculateMonteCarlo({
        ...input,
        numTrials: Math.min(input.numTrials, simulation.trials),
      }),
    getMonteCarloProgress: () => null,
  };
});
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/state",
  async (original) => {
    const { stateModule } = await import("./ledger-proof/counters");
    const settle = await vi.importActual<
      typeof import("@/lib/pure/engine/projection-year-handlers/settle")
    >("@/lib/pure/engine/projection-year-handlers/settle");
    return stateModule(await original(), settle.taxBucketsOf);
  },
);
vi.mock("@/lib/pure/engine/projection-year-handlers/settle", async (original) =>
  (await import("./ledger-proof/counters")).settleModule(await original()),
);
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/contribution-credits",
  async (original) =>
    (await import("./ledger-proof/counters")).contributionCreditsModule(
      await original(),
    ),
);
vi.mock("@/lib/pure/engine/individual-accounts/reconcile", async (original) =>
  (await import("./ledger-proof/counters")).reconcileModule(await original()),
);
vi.mock("@/lib/pure/engine/brokerage-basis", async (original) =>
  (await import("./ledger-proof/counters")).brokerageBasisModule(
    await original(),
  ),
);
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/year-draws",
  async (original) =>
    (await import("./ledger-proof/counters")).yearDrawsModule(await original()),
);
vi.mock("@/lib/pure/engine/withdrawal-solver", async (original) =>
  (await import("./ledger-proof/counters")).withdrawalSolverModule(
    await original(),
  ),
);
vi.mock("@/lib/pure/engine/individual-accounts/withdrawals", async (original) =>
  (await import("./ledger-proof/counters")).withdrawalsModule(await original()),
);
vi.mock("@/lib/pure/engine/individual-accounts/conversion", async (original) =>
  (await import("./ledger-proof/counters")).conversionModule(await original()),
);

import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import {
  BOUNDED,
  STOPS,
  failures,
  measure,
  totals,
  type RunClass,
  type Tally,
} from "./ledger-proof/counters";
import { createTestCaller } from "../routers/setup";
import { HOUSEHOLDS } from "../baseline/households";
import { conversionVariant } from "../baseline/households-converting";
import type { Household } from "../baseline/seed";
import { seedHousehold } from "../baseline/seed";
import { BASELINE_NOW } from "../baseline/router-suite";
import { PROCEDURES, callProcedure } from "../baseline/procedures";
import { PIN_DIRS } from "../baseline/pin-runs";
import { flatten, numberTree, type NumberTree } from "../baseline/numbers";
import {
  arbitraryInput,
  arbitraryRetiredInput,
  arbitraryRmdInput,
  withAccountsAndSpecs,
  withRothConversions,
} from "../pure/fixtures/engine-arbitraries";
import { arbitraryHousehold } from "../pure/fixtures/gross-up-households";
import {
  annRoth,
  boMatch,
  boSavingSpecs,
  couple,
  portfolioRoth,
  portfolioSavingSpecs,
  stoppedZeroRateCouple,
} from "../pure/fixtures/gap-year-couple";
import { boBrokerageSaving, twoEarners } from "../pure/fixtures/two-earners";
import { matchWithoutPool } from "../pure/fixtures/match-without-pool";
import { acct } from "../pure/fixtures/two-person-household";
import {
  twoYearHousehold,
  withSyntheticCategory,
} from "../fixtures/synthetic-category";

const SEED = 1;
const RUNS = 4;

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;
const simulationProcedure = PROCEDURES.find(
  (p) => p.path === "projection.computeSimulation",
)!;

/** The household's pinned projection: the router baseline's file, or the
 *  conversion variant's. */
function pinnedProjection(key: string): NumberTree {
  const file =
    key === "e2e-dc"
      ? path.join(PIN_DIRS.sync, "conversion", `${key}.json`)
      : path.join(
          __dirname,
          "../baseline/__baseline__",
          key,
          "projection.computeProjection.json",
        );
  return JSON.parse(fs.readFileSync(file, "utf8")) as NumberTree;
}

const runsOf = (t: Tally, cls: RunClass) => t.runs[cls] ?? 0;

const households: Household[] = [
  ...HOUSEHOLDS,
  conversionVariant(HOUSEHOLDS.find((h) => h.key === "e2e-d")!),
];

describe("the baseline households", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled"))),
    );
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Seeds the household, then runs `fn` on its caller. */
  async function withHousehold<T>(
    household: Household,
    fn: (call: (input: object, path?: string) => Promise<unknown>) => T,
  ): Promise<Awaited<T>> {
    const { caller, cleanup } = await createTestCaller();
    try {
      const ids = await seedHousehold(caller, household);
      return await fn(async (extra, procedurePath) => {
        const procedure =
          procedurePath === simulationProcedure.path
            ? simulationProcedure
            : projection;
        const input = procedure.input?.({ household, ids }) as object;
        return callProcedure(caller, procedure, { ...input, ...extra });
      });
    } finally {
      await cleanup();
    }
  }

  it.each(households.map((h) => [h.key, h] as const))(
    "%s: its projection equals its pin, and it and its Simple-mode Simulation hold the ledger",
    async (key, household) => {
      await withHousehold(household, async (call) => {
        let output: unknown;
        const projected = await measure(async () => {
          output = await call({});
        });
        expect(flatten(numberTree(output)!)).toEqual(
          flatten(pinnedProjection(key)),
        );
        expect(runsOf(projected, "held") + runsOf(projected, "synthetic")).toBe(
          1,
        );
        expect(failures(projected)).toEqual([]);
        const simple = await measure(() =>
          call({ taxMode: "simple" }, simulationProcedure.path),
        );
        expect(runsOf(simple, "synthetic")).toBeGreaterThanOrEqual(10);
        expect(failures(simple)).toEqual([]);
      });
    },
    120_000,
  );

  it("ws-h4: a 100-trial Simulation holds the ledger", async () => {
    simulation.trials = 100;
    try {
      await withHousehold(
        HOUSEHOLDS.find((h) => h.key === "ws-h4")!,
        async (call) => {
          const tally = await measure(() =>
            call({ numTrials: 100, seed: 31 }, simulationProcedure.path),
          );
          expect(runsOf(tally, "held")).toBeGreaterThanOrEqual(100);
          expect(failures(tally)).toEqual([]);
        },
      );
    } finally {
      simulation.trials = 10;
    }
  }, 300_000);
});

/** Each input's projection, measured together. */
const projectAll = (inputs: ProjectionInput[]) =>
  measure(() => {
    for (const input of inputs) calculateProjection(input);
  });

describe("the engine's fast-check generators, at a fixed seed", () => {
  const sample = <T>(arbitrary: fc.Arbitrary<T>) =>
    fc.sample(arbitrary, { seed: SEED, numRuns: RUNS });
  const cases: [string, () => ProjectionInput[]][] = [
    ["a working household", () => sample(arbitraryInput())],
    [
      "a working household with its own accounts and specs",
      () => sample(arbitraryInput()).map(withAccountsAndSpecs),
    ],
    ["a retired household", () => sample(arbitraryRetiredInput())],
    [
      "a retired household with its own accounts, converting",
      () =>
        sample(arbitraryRetiredInput()).map((input) =>
          withRothConversions(withAccountsAndSpecs(input)),
        ),
    ],
    ["a household past its RMD age", () => sample(arbitraryRmdInput())],
    [
      "a household past its RMD age with its own accounts",
      () => sample(arbitraryRmdInput()).map(withAccountsAndSpecs),
    ],
    ["the gross-up's households", () => sample(arbitraryHousehold)],
  ];
  it.each(cases)("%s", async (_, inputs) => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-01-01T12:00:00Z"),
    });
    try {
      const tally = await projectAll(inputs());
      expect(runsOf(tally, "noLedger")).toBe(0);
      expect(runsOf(tally, "held") + runsOf(tally, "synthetic")).toBe(RUNS);
      expect(failures(tally)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the named inputs whose specs pay their own account's part", () => {
  const cases: [string, () => ProjectionInput[]][] = [
    [
      "gap years: Bo's 401(k) saving, matched, saving and stopped",
      () => [
        couple({
          contributionSpecs: boSavingSpecs,
          employerMatchRateByCategory: boMatch,
        }),
        couple({
          contributionSpecs: boSavingSpecs,
          employerMatchRateByCategory: boMatch,
          gapYearStopSaving: true,
        }),
      ],
    ],
    [
      "gap years: a stopped year that is also a 0% year",
      () => [stoppedZeroRateCouple()],
    ],
    [
      "gap years: a Portfolio Roth saving",
      () => [
        couple({ contributionSpecs: portfolioSavingSpecs }),
        couple(
          { contributionSpecs: portfolioSavingSpecs, annualExpenses: 40000 },
          [
            annRoth(),
            acct("Bo Brokerage", "brokerage", 400000, 2, "afterTax"),
            portfolioRoth,
          ],
        ),
      ],
    ],
    [
      "two earners: Bo's fixed brokerage saving",
      () => [twoEarners({}, boBrokerageSaving)],
    ],
    [
      "a match with no 401(k) to land on, with and without specs",
      () => [matchWithoutPool(false), matchWithoutPool(true)],
    ],
  ];
  it.each(cases)("%s", async (_, inputs) => {
    const tally = await projectAll(inputs());
    expect(runsOf(tally, "held")).toBe(inputs().length);
    expect(failures(tally)).toEqual([]);
  });
});

describe("the synthetic second overflow target", () => {
  it("holds its ledger (D2, D3); its tax pricing isn't judged here", async () => {
    const tally = await measure(
      () =>
        withSyntheticCategory(() => calculateProjection(twoYearHousehold())),
      { forcedClass: "bo1" },
    );
    expect(runsOf(tally, "bo1")).toBe(1);
    expect(tally.counters.d2?.bo1?.n).toBeGreaterThan(0);
    expect(failures(tally)).toEqual([]);
  });
});

describe("the proof can fail", () => {
  it("a part $0.50 off its category after contributions is a D2 hit, named by its site", async () => {
    const control = await projectAll([twoEarners()]);
    expect(failures(control)).toEqual([]);
    const damaged = await measure(() => calculateProjection(twoEarners()), {
      damagePart: true,
    });
    const d2 = failures(damaged).filter((f) => f.startsWith("d2 "));
    expect(d2).toHaveLength(1);
    expect(d2[0]).toMatch(
      /^d2 \[held\] \d+ hits, first y-index 0 accumulation\.contributions 401k:traditional/,
    );
  });

  it("every counter was exercised, so no wrapper is left unused", () => {
    const exercised = Object.fromEntries(
      [...STOPS, ...BOUNDED].map((name) => [
        name,
        Object.values(totals().counters[name] ?? {}).reduce(
          (s, c) => s + c.n,
          0,
        ),
      ]),
    );
    console.log(
      `ledger proof: runs ${JSON.stringify(totals().runs)}, exercised ${JSON.stringify(exercised)}`,
    );
    // Every basis-tracking category holds a part on a ledger run, so
    // d3.noPart is never reached; D3, read by the same sample, shows it ran.
    const sampledWith: Record<string, string> = { "d3.noPart": "d3" };
    expect(
      Object.keys(exercised).filter(
        (name) => exercised[sampledWith[name] ?? name] === 0,
      ),
    ).toEqual([]);
  });
});
