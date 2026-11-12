/** A joint account with no job takes no percent (owner, "Joint percent rows"): every write that sets
 *  a method or a match type refuses one, read over the account's stored fields. */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedContributionAccount,
  seedContributionProfile,
} from "./setup";
import { JOINT_PERCENT_REFUSED } from "@/lib/config/display-labels";

describe("a joint account with no job takes no percent", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let joint: number;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
    joint = seedContributionAccount(ctx.db, {
      personId: null,
      ownership: "joint",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
      employerMatchType: "none",
    });
    profileId = seedContributionProfile(ctx.db, {
      name: "Joint dollars",
      contributionActiveFields: {
        contributionAccounts: {
          [joint]: {
            contributionMethod: "fixed_monthly",
            contributionValue: "100",
          },
        },
      },
    });
  });

  afterAll(() => cleanup());

  it("a profile can't give it a match on a percent of its contribution", async () => {
    await expect(
      caller.contributionProfile.setAccountActiveFields({
        profileId,
        accountId: joint,
        fields: { employerMatchType: "percent_of_contribution" },
      }),
    ).rejects.toThrow(JOINT_PERCENT_REFUSED.match);
    await expect(
      caller.contributionProfile.update({
        id: profileId,
        contributionActiveFields: {
          contributionAccounts: {
            [joint]: {
              contributionMethod: "fixed_monthly",
              contributionValue: "100",
              employerMatchType: "percent_of_contribution",
            },
          },
          deductions: {},
        },
      }),
    ).rejects.toThrow(JOINT_PERCENT_REFUSED.match);
  });

  it("a profile can't give it a percent of salary", async () => {
    await expect(
      caller.contributionProfile.setAccountActiveFields({
        profileId,
        accountId: joint,
        fields: { contributionMethod: "percent_of_salary" },
      }),
    ).rejects.toThrow(JOINT_PERCENT_REFUSED.salary);
  });

  it("a dollar amount and a dollar match still save", async () => {
    await expect(
      caller.contributionProfile.setAccountActiveFields({
        profileId,
        accountId: joint,
        fields: {
          contributionValue: "200",
          employerMatchType: "dollar_match",
          employerMatchValue: "500",
        },
      }),
    ).resolves.toBeTruthy();
  });
});
