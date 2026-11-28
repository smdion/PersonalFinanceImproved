import { describe, it, expect } from "vitest";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { buildIndividualYearBalances } from "@/lib/pure/engine/individual-accounts/reconcile";
import { yearAccountView } from "@/lib/pure/engine/individual-accounts/year-view";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";

const indKey = makeIndKey();

/** One part of each kind the view tells apart, in a decumulation year. */
function yearOf(balances: number[], draws: number[]) {
  const parts: IndividualAccountInput[] = [
    makeIndividualAccount({ name: "Held 401k", category: "401k" }),
    {
      ...makeIndividualAccount({ name: "Synthetic IRA", category: "ira" }),
      origin: "synthetic",
    },
    {
      ...makeIndividualAccount({
        name: "Projected brokerage",
        category: "brokerage",
        taxType: "afterTax",
      }),
      origin: "projected",
    },
  ];
  const keys = parts.map((p) => indKey(p));
  const records = buildIndividualYearBalances(
    parts,
    indKey,
    new Map(keys.map((k, i) => [k, balances[i]!])),
    new Map(keys.map((k) => [k, "Retirement"])),
    "decumulation",
    { withdrawal: new Map(keys.map((k, i) => [k, draws[i]!])) },
  );
  return { parts, records };
}

describe("yearAccountView", () => {
  it("builds a record for every part, in parts order", () => {
    const { records } = yearOf([0, 5000, 0], [0, 0, 0]);
    expect(records.map((r) => r.name)).toEqual([
      "Held 401k",
      "Synthetic IRA",
      "Projected brokerage",
    ]);
  });

  it("lists a held part even when empty, never a synthetic one, and no projected one while it holds nothing", () => {
    const { parts, records } = yearOf([0, 5000, 0], [0, 0, 0]);
    const view = yearAccountView(parts, records, true);
    expect(view.individualAccountBalances.map((r) => r.name)).toEqual([
      "Held 401k",
    ]);
  });

  it("lists a projected part once it holds money", () => {
    const { parts, records } = yearOf([0, 5000, 1200], [0, 0, 0]);
    const view = yearAccountView(parts, records, true);
    expect(view.individualAccountBalances.map((r) => r.name)).toEqual([
      "Held 401k",
      "Projected brokerage",
    ]);
  });

  it("lists a projected part that only drew this year", () => {
    const { parts, records } = yearOf([0, 0, 0], [0, 0, 300]);
    const view = yearAccountView(parts, records, true);
    expect(view.individualAccountBalances.map((r) => r.name)).toEqual([
      "Held 401k",
      "Projected brokerage",
    ]);
  });

  it("lists no rows on a run with no entered account", () => {
    const { parts, records } = yearOf([4000, 5000, 1200], [0, 0, 300]);
    expect(yearAccountView(parts, records, false)).toEqual({
      individualAccountBalances: [],
    });
  });
});
