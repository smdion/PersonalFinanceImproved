/**
 * contribution_active_fields is checked once on read and keeps today's
 * reading for a row the schema refuses (an older install's shape).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";

afterEach(() => vi.restoreAllMocks());

describe("readContributionActiveFields", () => {
  it("returns both buckets of a valid row as stored, without a warning", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const stored = {
      contributionAccounts: {
        "5": { contributionValue: "100", contributionMethod: "fixed_annual" },
      },
      deductions: { "2": { amountPerPeriod: "40" } },
    };
    const read = readContributionActiveFields(stored, 1);
    expect(read.contributionAccounts).toBe(stored.contributionAccounts);
    expect(read.deductions).toBe(stored.deductions);
    expect(logged).not.toHaveBeenCalled();
  });

  it("reads a missing bucket as empty", () => {
    expect(readContributionActiveFields({}, 1)).toEqual({
      contributionAccounts: {},
      deductions: {},
    });
  });

  it.each([
    ["a value outside a closed set", { employerMatchType: "retired_kind" }],
    [
      "a retired field",
      {
        contributionValue: "5",
        contributionMethod: "fixed_annual",
        legacyField: 1,
      },
    ],
    ["a value without its method", { contributionValue: "5" }],
  ])("warns on %s and still reads the row as stored", (_, entry) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const read = readContributionActiveFields(
      { contributionAccounts: { "9": entry } },
      3,
    );
    expect(read.contributionAccounts["9"]).toBe(entry);
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(logged.mock.calls[0]![0])) as {
      event: string;
      profileId: number;
    };
    expect(line).toMatchObject({
      event: "contribution_active_fields_unexpected_shape",
      profileId: 3,
    });
  });
});
