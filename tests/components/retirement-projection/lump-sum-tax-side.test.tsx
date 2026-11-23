/**
 * A lump sum saves the tax side of the part it picks: a lump sum added in
 * Changes by year to a Roth part carries `taxType: "roth"`, so the engine
 * puts it in that named part, not in the account's Traditional parts. An
 * account held in both tax parts under one name and owner shows one option
 * per part, labelled with its side; a category with no Roth side saves no
 * side (Traditional). The writers that rebuild a lump sum keep a saved side.
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
import { lumpSumParts, lumpSumTargetOf } from "@/lib/pure/engine";

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
      performanceAccountId: r.performanceAccountId,
      parentCategory: r.parentCategory,
      startingBalance: r.balance,
    }));
    const ls = roth as LumpSum;
    const target = lumpSumTargetOf(ls, parts);
    const targets = lumpSumParts({ ...ls, target }, parts);
    expect(targets.map((t) => [t.name, t.taxType])).toEqual([
      ["Invented Roth IRA", "taxFree"],
    ]);
  });

  it("no side for a category without one", () => {
    const saved = savedFromChangesByYear([
      ["2000", "Invented Brokerage::Invented Earner"],
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty("taxType");
  });

  it("an account held in both tax parts under one name and owner: one labelled option per part, and each saves its side", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const [trad, roth] = savedFromChangesByYear([
      ["1000", "Invented 401k::Invented Earner::traditional"],
      ["2000", "Invented 401k::Invented Earner::roth"],
    ]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Invented Roth IRA (Invented Earner)",
      "Invented Trad IRA (Invented Earner)",
      "Invented 401k (Invented Earner) (Traditional)",
      "Invented 401k (Invented Earner) (Roth)",
      "Invented Brokerage (Invented Earner)",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    expect(trad).toMatchObject({
      targetAccountName: "Invented 401k",
      taxType: "traditional",
      targetPerformanceAccountId: 93,
      targetOwnerPersonId: 61,
    });
    expect(roth).toMatchObject({
      targetAccountName: "Invented 401k",
      taxType: "roth",
      targetPerformanceAccountId: 93,
      targetOwnerPersonId: 61,
    });
    const parts = rows.map((r): IndividualAccountInput => ({
      name: r.name,
      category: r.category,
      taxType: r.taxType,
      ownerName: r.ownerName,
      ownerPersonId: r.ownerPersonId,
      performanceAccountId: r.performanceAccountId,
      parentCategory: r.parentCategory,
      startingBalance: r.balance,
    }));
    const ls = roth as LumpSum;
    const target = lumpSumTargetOf(ls, parts);
    expect(
      lumpSumParts({ ...ls, target }, parts).map((t) => t.taxType),
    ).toEqual(["taxFree"]);
  });

  it("the Brokerage page: the Roth part of an account held in both tax parts can be picked", () => {
    const onAdd = vi.fn<(ls: LumpSumEvent) => void>();
    render(
      <LumpSumForm
        accounts={rows.map((r) => accountOption(r, false))}
        onAdd={onAdd}
        allowWithdrawals
      />,
    );
    expect(
      screen.getByRole("option", { name: "Invented 401k (Roth)" }),
    ).toBeTruthy();
    addLumpSum("500", "Invented 401k::::roth");
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
      targetAccountName: "Invented 401k",
      taxType: "roth",
      targetPerformanceAccountId: 93,
    });
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
