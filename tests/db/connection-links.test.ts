/**
 * A connection's links after a non-admin's restore: today's mapping stays
 * only where its target is the same restored row (id and name), per part
 * for a mortgage's two; the backup's fill the other parts, never doubling a
 * part or a row a kept mapping names.
 */
import { describe, it, expect } from "vitest";
import {
  matchedLinks,
  type TargetRows,
} from "@/lib/db/backup/connection-links";

const rows = (
  entries: [number, Record<string, unknown>][],
): Map<number, Record<string, unknown>> =>
  new Map(entries.map(([id, r]) => [id, { id, ...r }]));

function targets(over: Partial<TargetRows> = {}): TargetRows {
  return {
    asset: new Map(),
    loan: rows([[7, { name: "House" }]]),
    debt: rows([[3, { name: "Car loan" }]]),
    performance: rows([[5, { account_label: "401k" }]]),
    profile: new Map(),
    ...over,
  };
}

const mapping = (remote: string, extra: Record<string, unknown>) => ({
  localName: "ignored",
  remoteAccountId: remote,
  syncDirection: "pull",
  ...extra,
});

describe("matchedLinks", () => {
  it("keeps each part of a mortgage that holds, and the backup's for a part that doesn't", () => {
    const today = targets();
    const restored = targets();
    const ours = {
      account_mappings: [
        mapping("zillow", { loanId: 7, loanMapType: "propertyValue" }),
        mapping("lender-new", { loanId: 9, loanMapType: "loanBalance" }),
      ],
    };
    const theirs = {
      account_mappings: [
        mapping("zillow-old", { loanId: 7, loanMapType: "propertyValue" }),
        mapping("lender", { loanId: 7, loanMapType: "loanBalance" }),
      ],
    };
    const { account_mappings } = matchedLinks(ours, theirs, today, restored);
    expect(account_mappings).toEqual([
      ours.account_mappings[0],
      // zillow-old names the property value a kept mapping names: not taken.
      theirs.account_mappings[1],
    ]);
  });

  it("one mapping per remote account: today's kept on a loan part, the backup's same remote to an asset isn't taken", () => {
    const today = targets({ asset: rows([[2, { name: "Car" }]]) });
    const restored = targets({ asset: rows([[2, { name: "Car" }]]) });
    const ours = {
      account_mappings: [
        mapping("A", { loanId: 7, loanMapType: "loanBalance" }),
      ],
    };
    const theirs = { account_mappings: [mapping("A", { assetId: 2 })] };
    const { account_mappings } = matchedLinks(ours, theirs, today, restored);
    expect(account_mappings).toEqual(ours.account_mappings);
  });

  it("a debt or Portfolio account renamed since isn't the same row; never matched by name alone", () => {
    const today = targets({
      debt: rows([[3, { name: "Car loan" }]]),
      performance: rows([[5, { account_label: "401k" }]]),
    });
    const restored = targets({
      debt: rows([[3, { name: "Old card" }]]),
      performance: rows([[6, { account_label: "401k" }]]),
    });
    const ours = {
      account_mappings: [
        mapping("card", { debtId: 3 }),
        mapping("fidelity", { performanceAccountId: 5, syncDirection: "push" }),
        mapping("checking", { localId: "cash" }),
      ],
    };
    const { account_mappings } = matchedLinks(
      ours,
      { account_mappings: null },
      today,
      restored,
    );
    expect(account_mappings).toEqual([ours.account_mappings[2]]);
  });

  it("keeps SQLite's JSON text form", () => {
    const today = targets();
    const ours = {
      account_mappings: JSON.stringify([mapping("card", { debtId: 3 })]),
    };
    expect(
      matchedLinks(ours, undefined, today, targets()).account_mappings,
    ).toBe(ours.account_mappings);
  });
});
