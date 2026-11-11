/** The stored employer match type, read once where a profile merges onto an account. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readStoredMatchType } from "@/lib/db/stored-match-type";

afterEach(() => vi.restoreAllMocks());

/** The events logged while `run` reads. */
function eventsDuring(run: () => void): unknown[] {
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  run();
  const events = logged.mock.calls.map(([line]) => JSON.parse(String(line)));
  logged.mockRestore();
  return events;
}

describe("readStoredMatchType", () => {
  it("reads a type in the set as is, without a log or a flag", () => {
    expect(
      eventsDuring(() =>
        expect(
          readStoredMatchType({ id: 1, employerMatchType: "dollar_match" }, {}),
        ).toEqual({ employerMatchType: "dollar_match" }),
      ),
    ).toEqual([]);
  });

  it('reads "" as no match: a known spelling, not logged or flagged', () => {
    expect(
      eventsDuring(() =>
        expect(
          readStoredMatchType({ id: 2, employerMatchType: "" }, {}),
        ).toEqual({ employerMatchType: "none" }),
      ),
    ).toEqual([]);
  });

  it("an entry's own type wins over the account's", () => {
    expect(
      readStoredMatchType(
        { id: 3, employerMatchType: "bogus" },
        { employerMatchType: "percent_of_contribution" },
      ),
    ).toEqual({ employerMatchType: "percent_of_contribution" });
  });

  it("reads an unknown type as no match, flagged, logged once per account", () => {
    const events = eventsDuring(() => {
      for (let i = 0; i < 2; i++)
        expect(
          readStoredMatchType({ id: 4, employerMatchType: "match_50" }, {}),
        ).toEqual({ employerMatchType: "none", matchTypeUnrecognised: true });
      readStoredMatchType({ id: 5, employerMatchType: "match_50" }, {});
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "contribution_account_unknown_match_type",
        accountId: 4,
        stored: "match_50",
      }),
      expect.objectContaining({ accountId: 5 }),
    ]);
  });
});
