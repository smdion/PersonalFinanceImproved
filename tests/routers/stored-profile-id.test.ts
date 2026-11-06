/**
 * A stored active Contribution or Salary Profile id that isn't a whole
 * number: the three paths that feed it to a summary refuse it as the
 * summary's own procedure refuses that id (BAD_REQUEST, its message);
 * the What-If income figure catches it as null. A value that isn't a
 * number at all reads as no profile picked, as before.
 */
import "./setup-mocks";
import { describe, it, expect, onTestFinished, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import {
  createTestCaller,
  seedAppSetting,
  seedContributionProfile,
  seedStandardDataset,
} from "./setup";

type Harness = Awaited<ReturnType<typeof createTestCaller>>;
type Stored = Parameters<typeof seedAppSetting>[2];

/** Write a setting over whatever the standard dataset stored. */
function store(h: Harness, key: string, value: Stored): void {
  h.db
    .delete(sqliteSchema.appSettings)
    .where(eq(sqliteSchema.appSettings.key, key))
    .run();
  seedAppSetting(h.db, key, value);
}

async function withHousehold<T>(
  stored: Record<string, Stored>,
  run: (h: Harness) => Promise<T>,
): Promise<T> {
  const h = await createTestCaller();
  try {
    seedStandardDataset(h.db);
    for (const [key, value] of Object.entries(stored)) store(h, key, value);
    return await run(h);
  } finally {
    h.cleanup();
  }
}

/** What a summary's procedure answers for that id: the refusal to match. */
async function refusal(call: () => Promise<unknown>) {
  const error = await call().then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toMatchObject({ code: "BAD_REQUEST" });
  return (error as Error).message;
}

const BAD: Array<[string, string, Stored, number]> = [
  ["2.5", SK_ACTIVE_CONTRIB_PROFILE_ID, 2.5, 2.5],
  ['"1e400"', SK_ACTIVE_CONTRIB_PROFILE_ID, "1e400", Infinity],
  ["2.5 (salary)", SK_ACTIVE_SALARY_PROFILE_ID, 2.5, 2.5],
];

describe.each(BAD)("a stored active id of %s", (_label, key, value, id) => {
  const field =
    key === SK_ACTIVE_CONTRIB_PROFILE_ID
      ? "contributionProfileId"
      : "salaryProfileId";

  it("budget.listProfiles: the paycheck summary's BAD_REQUEST", async () => {
    await withHousehold({ [key]: value }, async ({ caller }) => {
      const message = await refusal(() =>
        caller.paycheck.computeSummary({ [field]: id }),
      );
      await expect(caller.budget.listProfiles()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message,
      });
    });
  });

  it("budget.computeActiveSummary: the take-home figure is null, the rest computes", async () => {
    await withHousehold({ [key]: value }, async ({ caller }) => {
      const summary = await caller.budget.computeActiveSummary();
      expect(summary?.netMonthlyIncome).toBeNull();
      expect(summary?.result).toBeTruthy();
    });
  });

  it("milestones.recordReached: the contribution summary's BAD_REQUEST", async () => {
    await withHousehold({ [key]: value }, async ({ caller }) => {
      const message = await refusal(() =>
        caller.contribution.computeSummary({ [field]: id }),
      );
      await expect(caller.milestones.recordReached()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message,
      });
    });
  });
});

describe("stored active ids that the paths accept", () => {
  it('"abc" reads as no profile picked, the same as none stored', async () => {
    // One clock for both runs (recordReached dates what it records); the
    // database stamps each row's creation itself, so those are left out.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-03-07T18:00:00Z"),
    });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const none = await withHousehold({}, async ({ caller }) => ({
      profiles: await caller.budget.listProfiles(),
      summary: await caller.budget.computeActiveSummary(),
      reached: await caller.milestones.recordReached(),
    }));
    const abc = await withHousehold(
      { [SK_ACTIVE_CONTRIB_PROFILE_ID]: "abc" },
      async ({ caller }) => ({
        profiles: await caller.budget.listProfiles(),
        summary: await caller.budget.computeActiveSummary(),
        reached: await caller.milestones.recordReached(),
      }),
    );
    const unstamped = (v: unknown): unknown =>
      JSON.parse(
        JSON.stringify(v, (k, val: unknown) =>
          k === "createdAt" || k === "updatedAt" ? undefined : val,
        ),
      );
    expect(unstamped(abc)).toEqual(unstamped(none));
  });

  it("a whole-number id computes on every path", async () => {
    const h = await createTestCaller();
    try {
      seedStandardDataset(h.db);
      const id = seedContributionProfile(h.db, { name: "Picked" });
      store(h, SK_ACTIVE_CONTRIB_PROFILE_ID, id);
      const summary = await h.caller.budget.computeActiveSummary();
      expect(summary?.netMonthlyIncome).toEqual(expect.any(Number));
      await expect(h.caller.budget.listProfiles()).resolves.toBeTruthy();
      await expect(h.caller.milestones.recordReached()).resolves.toBeDefined();
    } finally {
      h.cleanup();
    }
  });
});
