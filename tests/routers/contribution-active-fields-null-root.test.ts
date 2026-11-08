/**
 * A Contribution Profile whose contribution_active_fields holds a JSON null
 * (a hand edit) reads as an empty profile, as it did before the shared
 * reader: net pay per check and the IRS-limit check give the same result
 * as for `{}`.
 */
import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import {
  adminSession,
  createTestCaller,
  seedAppSetting,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerson,
} from "./setup";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { computeJobNetPayPerCheck } from "@/server/services/paycheck/job-net-pay";
import { assertWithinIrsLimits } from "@/server/services/contributions/caps";

/** The outcome of `run`, as a value or the error's message. */
async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function underRoot(root: "null" | "{}") {
  const { db, rawDb, sqlite, cleanup } = await createTestCaller(adminSession);
  try {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const personId = await seedPerson(db, "Null Root");
    const jobId = seedJob(db, personId, { payPeriod: "biweekly" });
    const accountId = seedContributionAccount(db, { personId, jobId });
    const profileId = seedContributionProfile(db, { name: "Hand edited" });
    sqlite
      .prepare("DELETE FROM app_settings WHERE key = ?")
      .run(SK_ACTIVE_CONTRIB_PROFILE_ID);
    seedAppSetting(db, SK_ACTIVE_CONTRIB_PROFILE_ID, profileId);
    sqlite
      .prepare(
        "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE id = ?",
      )
      .run(root, profileId);
    return {
      netPay: await outcome(() => computeJobNetPayPerCheck(rawDb, jobId)),
      capCheck: await outcome(() =>
        assertWithinIrsLimits(rawDb, { profileId: null, touched: [accountId] }),
      ),
    };
  } finally {
    vi.restoreAllMocks();
    cleanup();
  }
}

describe("a JSON-null contribution_active_fields root", () => {
  it("reads as an empty profile in net pay and the IRS-limit check", async () => {
    const empty = await underRoot("{}");
    expect(empty.netPay).toHaveProperty("value");
    expect(await underRoot("null")).toEqual(empty);
  });
});
