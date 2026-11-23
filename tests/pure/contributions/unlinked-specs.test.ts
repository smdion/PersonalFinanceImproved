import { describe, expect, it } from "vitest";
import { unlinkedSpecsNote } from "@/lib/pure/contributions/unlinked-specs";
import { makeContributionSpec } from "../fixtures/engine-fixtures";
import type { ContributionSpec } from "@/lib/pure/engine/types";

const spec = (
  contributionAccountId: number,
  account: ContributionSpec["account"],
) => makeContributionSpec({ contributionAccountId, account });
const unlinked = { kind: "unlinked" } as const;
const linked = { kind: "performance", performanceAccountId: 3 } as const;

describe("the note for contribution accounts linked to no account", () => {
  it("says nothing when every contribution names an account", () => {
    expect(unlinkedSpecsNote([spec(1, linked)], [])).toEqual([]);
    expect(unlinkedSpecsNote([spec(1, { kind: "synthetic" })], [])).toEqual([]);
  });

  it("counts one contribution account once, across the defaults and every switch", () => {
    const [note] = unlinkedSpecsNote(
      [spec(1, unlinked), spec(2, linked)],
      [{ contributionSpecs: [spec(1, unlinked)] }],
    );
    expect(note).toMatch(/^1 contribution account isn't linked/);
  });

  it("names how many when there are several", () => {
    const [note] = unlinkedSpecsNote(
      [spec(1, unlinked)],
      [{ contributionSpecs: [spec(4, unlinked)] }],
    );
    expect(note).toMatch(/^2 contribution accounts aren't linked/);
  });
});
