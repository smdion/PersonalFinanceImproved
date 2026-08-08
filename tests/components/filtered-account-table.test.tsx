import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilteredAccountTable } from "@/components/performance/filtered-account-table";

// Smoke test for FilteredAccountTable — a pure presentational table used for
// ad hoc account/year selections in the Performance page. No trpc/provider
// dependencies, so this renders the component directly.

describe("FilteredAccountTable", () => {
  it("renders the empty state when there are no rows", () => {
    render(<FilteredAccountTable rows={[]} />);
    expect(
      screen.getByText(
        "No performance data for the selected accounts and years.",
      ),
    ).toBeInTheDocument();
  });

  it("renders rows newest-year-first with gain/loss and return formatting", () => {
    render(
      <FilteredAccountTable
        rows={[
          {
            year: 2024,
            beginBal: 100000,
            contribs: 5000,
            gainLoss: 8000,
            endBal: 113000,
            employer: 2000,
            distributions: 0,
            fees: 100,
            rollovers: 0,
            returnPct: 0.08,
          },
          {
            year: 2025,
            beginBal: 120000,
            contribs: 5000,
            gainLoss: -3000,
            endBal: 117500,
            employer: 2000,
            distributions: 0,
            fees: 100,
            rollovers: 0,
            returnPct: null,
          },
        ]}
      />,
    );

    // Newest year (2025) renders first in the table body.
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row
    expect(rows[1]).toHaveTextContent("2025");
    expect(rows[2]).toHaveTextContent("2024");

    // Null return renders as an em dash rather than a formatted percent.
    expect(rows[1]).toHaveTextContent("—");

    // Both formatted ending-balance values appear.
    expect(screen.getByText("$117,500.00")).toBeInTheDocument();
    expect(screen.getByText("$113,000.00")).toBeInTheDocument();
  });
});
