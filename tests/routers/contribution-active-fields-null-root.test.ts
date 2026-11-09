/**
 * A Contribution Profile whose contribution_active_fields holds a JSON null
 * (a hand edit) reads as an empty profile, as it did before the shared
 * reader: net pay per check and the IRS-limit check give the same result
 * as for `{}`, and deleting a row's entries leaves that root as it is.
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
import { dropContributionActiveFields } from "@/server/data/delete-references";

/** The outcome of `run`, as a value or the error's message. */
async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const AS_OF = new Date("2026-03-07T12:00:00");
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
      netPay: await outcome(() =>
        computeJobNetPayPerCheck(rawDb, jobId, AS_OF),
      ),
      capCheck: await outcome(() =>
        assertWithinIrsLimits(
          rawDb,
          { profileId: null, touched: [accountId] },
          AS_OF,
        ),
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

describe("dropContributionActiveFields", () => {
  /** Runs the drop of contribution account 7 over one profile whose stored
   *  root is `root`, and returns the root as stored after. */
  async function dropOver(root: string): Promise<string> {
    const { db, rawDb, sqlite, cleanup } = await createTestCaller(adminSession);
    try {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const profileId = seedContributionProfile(db, { name: "Invented" });
      sqlite
        .prepare(
          "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE id = ?",
        )
        .run(root, profileId);
      await dropContributionActiveFields(rawDb, "contributionAccounts", 7);
      return (
        sqlite
          .prepare(
            "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE id = ?",
          )
          .get(profileId) as { f: string }
      ).f;
    } finally {
      vi.restoreAllMocks();
      cleanup();
    }
  }

  it("leaves a JSON-null root as it is", async () => {
    expect(await dropOver("null")).toBe("null");
  });

  it("drops the row's entry from an object root, keeping the rest", async () => {
    const after = await dropOver(
      JSON.stringify({
        contributionAccounts: { "7": { annualAmount: 100 }, "8": {} },
        deductions: {},
      }),
    );
    expect(JSON.parse(after)).toEqual({
      contributionAccounts: { "8": {} },
      deductions: {},
    });
  });
});
