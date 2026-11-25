/**
 * contribution_active_fields is checked once on read; a row of another
 * shape throws, naming the profile.
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

  it("reads past a key the shape doesn't know (a newer Ledgr's), returning the entry as stored, without a warning", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const entry = {
      contributionValue: "5",
      contributionMethod: "fixed_annual",
      catchupRoute: "roth",
    };
    const read = readContributionActiveFields(
      { contributionAccounts: { "9": entry }, newerBucket: {} },
      3,
    );
    expect(read.contributionAccounts["9"]).toBe(entry);
    expect(logged).not.toHaveBeenCalled();
  });

  it("still refuses a value without its method beside a key the shape doesn't know", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const entry = { contributionValue: "5", catchupRoute: "roth" };
    expect(() =>
      readContributionActiveFields({ contributionAccounts: { "9": entry } }, 7),
    ).toThrow("Contribution Profile 7");
  });

  it.each([
    ["a value outside a closed set", { employerMatchType: "retired_kind" }],
    [
      "a key outside the shape beside a refused value",
      {
        contributionValue: "5",
        contributionMethod: "fixed_annual",
        legacyField: 1,
        isActive: "yes",
      },
    ],
    ["a value without its method", { contributionValue: "5" }],
  ])("throws on %s, naming the profile, and logs it once", (_, entry) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 2; i++)
      expect(() =>
        readContributionActiveFields(
          { contributionAccounts: { "9": entry } },
          3,
        ),
      ).toThrow(
        "Contribution Profile 3: its stored active fields don't fit their shape",
      );
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

  it.each([
    ["a JSON null", null],
    ["an array", []],
    ["a scalar", 42],
    ["a double-encoded string", JSON.stringify({ contributionAccounts: {} })],
  ])("throws on a root that is %s", (_, root) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => readContributionActiveFields(root, 41)).toThrow(
      "Contribution Profile 41",
    );
  });
});
