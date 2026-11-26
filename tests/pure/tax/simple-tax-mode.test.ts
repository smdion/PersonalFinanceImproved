/**
 * Simple mode's setup notes: the notes that describe the household's
 * accounts (marked by `accountNoteAt`) don't apply to the pot, so Simple
 * leaves exactly those out; Standard keeps every note, in order.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import {
  toSimpleTaxMode,
  type SimpleTaxModeParts,
} from "@/lib/pure/tax/simple-tax-mode";
import { acct, household } from "../fixtures/two-person-household";

const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
const parts: SimpleTaxModeParts = {
  retirementBuckets: {
    preTax: 500000,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  },
  defaults: {
    baseYearContributions: zero,
    baseYearEmployerMatch: zero,
    employerMatchRateByCategory: zero,
    accountSplits: { ...zero, "401k": 1 },
    taxSplits: {},
  },
};

const NOTES = [
  "setup A",
  "unlinked rows",
  "setup B",
  "unlinked contributions",
  "setup C",
];

function withNotes() {
  return {
    ...household([acct("Ann 401k", "401k", 500000, 1)]),
    inputWarnings: NOTES,
    accountNoteAt: [1, 3],
  };
}

/** The input's notes as a run shows them: its warnings, in their order. */
const shown = (warnings: string[]) => warnings.filter((w) => NOTES.includes(w));

describe("Simple mode's setup notes", () => {
  it("leaves out exactly the notes that describe the accounts, keeping the rest in order", () => {
    const simple = toSimpleTaxMode(withNotes(), parts);
    expect(simple.inputWarnings).toEqual(["setup A", "setup B", "setup C"]);
    expect(simple.accountNoteAt).toBeUndefined();
    expect(shown(calculateProjection(simple).warnings)).toEqual([
      "setup A",
      "setup B",
      "setup C",
    ]);
  });

  it("leaves Standard's notes as they are, every one in its place", () => {
    expect(shown(calculateProjection(withNotes()).warnings)).toEqual(NOTES);
  });

  it("keeps every note when none describes the accounts", () => {
    const { accountNoteAt: _at, ...input } = withNotes();
    expect(toSimpleTaxMode(input, parts).inputWarnings).toEqual(NOTES);
  });
});
