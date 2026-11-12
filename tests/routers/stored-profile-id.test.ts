/**
 * A stored active Contribution or Salary Profile id that isn't a whole
 * number is refused with BAD_REQUEST by the one reader (activeProfileId),
 * on every path that reads it: never read as no profile, never $0.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
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

const BAD: Array<[string, string, Stored]> = [
  ["2.5", SK_ACTIVE_CONTRIB_PROFILE_ID, 2.5],
  ['"1e400"', SK_ACTIVE_CONTRIB_PROFILE_ID, "1e400"],
  ['"abc"', SK_ACTIVE_CONTRIB_PROFILE_ID, "abc"],
  ["2.5 (salary)", SK_ACTIVE_SALARY_PROFILE_ID, 2.5],
];

describe.each(BAD)(
  "a stored active id of %s is refused",
  (_label, key, value) => {
    const refused = { code: "BAD_REQUEST" };
    it("on the Budget page's profiles, its summary and the milestones", async () => {
      await withHousehold({ [key]: value }, async ({ caller }) => {
        await expect(caller.budget.listProfiles()).rejects.toMatchObject(
          refused,
        );
        await expect(
          caller.budget.computeActiveSummary(),
        ).rejects.toMatchObject(refused);
        await expect(caller.milestones.recordReached()).rejects.toMatchObject(
          refused,
        );
      });
    });
  },
);

describe("stored active ids that the paths accept", () => {
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
