/**
 * A lump sum saves the tax side of the part it picks: a lump sum added in
 * Changes by year to a Roth part carries `taxType: "roth"`, so the engine
 * puts it in that named part, not in the account's Traditional parts. A pick
 * whose name and owner span both of an account's tax parts, or a category
 * with no Roth side, saves no side (Traditional). The writers that
 * rebuild a lump sum from its fields keep a saved side.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LumpSumFields } from "@/components/retirement-projection/overrides/override-field-parts";
import { LumpSumForm } from "@/components/retirement-projection/lump-sum-form";
import {
  accountOption,
  lumpSumTarget,
} from "@/components/retirement-projection/lump-sum-target";
import type {
  AccumOverride,
  LumpSumEvent,
} from "@/components/retirement-projection/types";
import type {
  IndividualAccountInput,
  IndividualAccountYearBalance,
} from "@/lib/pure/accounts/account-balances.types";
import type { LumpSum } from "@/lib/pure/engine/types";
import { resolveLumpSumTargets } from "@/lib/pure/engine/projection-year-handlers/lump-sum";

/** The projection's first-year rows: a Roth IRA and a Traditional IRA of one
 *  owner, a 401k held in both tax parts, and a brokerage account. */
const row = (
  name: string,
  category: string,
  taxType: string,
  performanceAccountId: number,
) => ({
  name,
  category,
  taxType,
  ownerName: "Invented Earner",
  ownerPersonId: 61,
  performanceAccountId,
  parentCategory: "Retirement",
  balance: 1000,
});
const rows = [
  row("Invented Roth IRA", "ira", "taxFree", 91),
  row("Invented Trad IRA", "ira", "preTax", 92),
  row("Invented 401k", "401k", "preTax", 93),
  row("Invented 401k", "401k", "taxFree", 93),
  row("Invented Brokerage", "brokerage", "afterTax", 94),
] as IndividualAccountYearBalance[];

function addLumpSum(amount: string, option: string) {
  fireEvent.change(screen.getByLabelText("Account"), {
    target: { value: option },
  });
  fireEvent.change(screen.getByPlaceholderText("$50,000"), {
    target: { value: amount },
  });
  fireEvent.click(screen.getByText("Add"));
}

/** The lump sums Changes by year saves for one year. */
function savedFromChangesByYear(picks: [string, string][]) {
  const setAccumOverrides = vi.fn();
  render(
    <LumpSumFields
      isPostRetirement={false}
      resetWizard={vi.fn()}
      selectedYear="2040"
      state={
        {
          individualAccountNames: rows.map((r) => accountOption(r)),
          setAccumOverrides,
          setDecumOverrides: vi.fn(),
          result: { projectionByYear: [] },
        } as never
      }
      year={2040}
    />,
  );
  for (const [amount, option] of picks) addLumpSum(amount, option);
  let saved: AccumOverride[] = [];
  for (const [update] of setAccumOverrides.mock.calls) saved = update(saved);
  return saved.flatMap((o) => o.lumpSums ?? []);
}

describe("a lump sum's tax side, as the forms save it", () => {
  it("Changes by year: a Roth part saves the Roth side and a Traditional part the Traditional one", () => {
    const [roth, trad] = savedFromChangesByYear([
      ["1000", "Invented Roth IRA::Invented Earner"],
      ["2000", "Invented Trad IRA::Invented Earner"],
    ]);
    expect(roth).toMatchObject({
      targetAccount: "ira",
      targetAccountName: "Invented Roth IRA",
      taxType: "roth",
    });
    expect(trad).toMatchObject({
      targetAccountName: "Invented Trad IRA",
      taxType: "traditional",
    });
  });

  it("the engine puts the saved Roth lump sum in the named Roth part", () => {
    const [roth] = savedFromChangesByYear([
      ["1000", "Invented Roth IRA::Invented Earner"],
    ]);
    const parts = rows.map((r): IndividualAccountInput => ({
      name: r.name,
      category: r.category,
      taxType: r.taxType,
      ownerName: r.ownerName,
      ownerPersonId: r.ownerPersonId,
      parentCategory: r.parentCategory,
      startingBalance: r.balance,
    }));
    const targets = resolveLumpSumTargets(roth as LumpSum, parts);
    expect(targets.map((t) => [t.name, t.taxType])).toEqual([
      ["Invented Roth IRA", "taxFree"],
    ]);
  });

  it("no side when the pick spans both tax parts, or the category has none", () => {
    const saved = savedFromChangesByYear([
      ["1000", "Invented 401k::Invented Earner"],
      ["2000", "Invented Brokerage::Invented Earner"],
    ]);
    expect(saved).toHaveLength(2);
    for (const ls of saved) expect(ls).not.toHaveProperty("taxType");
  });

  it("the Brokerage page's event carries the side, and its rebuild keeps it", () => {
    const onAdd = vi.fn<(ls: LumpSumEvent) => void>();
    render(
      <LumpSumForm
        accounts={rows.map((r) => accountOption(r, false))}
        onAdd={onAdd}
        allowWithdrawals
      />,
    );
    addLumpSum("500", "Invented Roth IRA::");
    addLumpSum("700", "Invented Brokerage::");
    const [roth, brokerage] = onAdd.mock.calls.map(([e]) => e);
    expect(roth).toMatchObject({ taxType: "roth" });
    expect(brokerage).toMatchObject({ taxType: "" });
    expect(lumpSumTarget(roth!)).toMatchObject({ taxType: "roth" });
    expect(lumpSumTarget(brokerage!)).not.toHaveProperty("taxType");
  });
});
