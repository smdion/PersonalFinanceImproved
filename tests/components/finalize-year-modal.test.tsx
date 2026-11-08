/**
 * Smoke test for the Finalize-year dialog (v0.10.4 commit 5b, before 7
 * moves it onto Modal): each category's figures render in display order,
 * open checks are listed before locking, and an edited figure reaches
 * onConfirm, the input the page sends to performance.finalizeYear.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FinalizeYearModal } from "@/components/performance/finalize-year-modal";
import type { AccountRow, AnnualRow } from "@/components/performance/types";

function annual(
  id: number,
  category: AnnualRow["category"],
  beginning: number,
  ending: number,
): AnnualRow {
  return {
    id,
    year: 2026,
    category,
    beginningBalance: beginning,
    totalContributions: 12000,
    yearlyGainLoss: ending - beginning - 12000,
    endingBalance: ending,
    annualReturnPct: 0.08,
    employerContributions: 3000,
    distributions: 0,
    fees: 25,
    rollovers: 0,
    lifetimeGains: 40000,
    lifetimeContributions: 90000,
    lifetimeMatch: 15000,
    isCurrentYear: true,
    isFinalized: false,
  };
}

// The page passes them unordered; the dialog shows its display order.
const rows = [
  annual(2, "HSA", 9000, 12500),
  annual(1, "401k/IRA", 150000, 178000),
];

const flagged: AccountRow = {
  id: 5,
  institution: "Example Funds",
  accountLabel: "Jordan 401k (Example Funds)",
  ownerName: "Jordan",
  ownerPersonId: 1,
  ownershipType: "individual",
  beginningBalance: 150000,
  totalContributions: 12000,
  yearlyGainLoss: 16000,
  endingBalance: 178050,
  annualReturnPct: 0.1,
  employerContributions: 3000,
  fees: 25,
  distributions: 0,
  rollovers: 0,
  parentCategory: "Retirement",
  accountType: "401k",
  subType: null,
  isActive: true,
  performanceAccountId: 3,
  displayOrder: 1,
  year: 2026,
  contributionBasis: null,
  conversionBasis: null,
  latestConversionYear: null,
  checks: [{ kind: "unbalanced", amount: 50, accepted: false }],
  estimatedFields: [],
};

describe("FinalizeYearModal", () => {
  it("shows each category's figures and the checks still open", () => {
    render(
      <FinalizeYearModal
        year={2026}
        rows={rows}
        accounts={[flagged]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isPending={false}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Finalize 2026" });
    const headers = within(dialog)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Field", "401k/IRA", "HSA"]);
    expect(within(dialog).getByText("$178,000.00")).toBeTruthy();
    expect(dialog).toHaveTextContent("Before you lock 2026");
    expect(dialog).toHaveTextContent("Doesn't add up by $50.00");
    expect(
      within(dialog).getByRole("button", { name: "Finalize 2026 anyway" }),
    ).toBeTruthy();
  });

  it("confirms with an edited figure", () => {
    const onConfirm = vi.fn();
    render(
      <FinalizeYearModal
        year={2026}
        rows={rows}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        isPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "$12,500.00" }));
    const input = screen.getByDisplayValue("12500.00");
    fireEvent.change(input, { target: { value: "12750.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Finalize 2026" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [overrides] = onConfirm.mock.calls[0] as [
      { category: string; endingBalance: string; beginningBalance: string }[],
    ];
    expect(overrides.map((o) => o.category)).toEqual(["401k/IRA", "HSA"]);
    expect(overrides[1]).toEqual(
      expect.objectContaining({
        category: "HSA",
        beginningBalance: "9000.00",
        endingBalance: "12750.5",
      }),
    );
    expect(overrides[0]).toEqual(
      expect.objectContaining({ endingBalance: "178000.00" }),
    );
  });
});
