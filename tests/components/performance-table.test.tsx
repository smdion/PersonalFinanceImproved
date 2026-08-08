import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PerformanceTable } from "@/components/performance/performance-table";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import type {
  AnnualRow,
  AccountRow,
  MasterAccount,
} from "@/components/performance/types";

// HelpTip renders a Radix Tooltip, which requires a TooltipProvider ancestor
// that PerformanceTable does not supply on its own (it's normally mounted
// under the page's provider tree). Stub it out like other smoke tests do.
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

// Smoke test for PerformanceTable — the main read/edit table on the
// Performance page. Purely props-driven (no trpc calls of its own), so it
// renders directly against fabricated AnnualRow/AccountRow data.

const annualRows: AnnualRow[] = [
  {
    id: 1,
    year: 2025,
    category: PERF_CATEGORY_RETIREMENT,
    beginningBalance: 100000,
    totalContributions: 10000,
    yearlyGainLoss: 8000,
    endingBalance: 118000,
    annualReturnPct: 0.08,
    employerContributions: 3000,
    distributions: 0,
    fees: 50,
    rollovers: 0,
    lifetimeGains: 30000,
    lifetimeContributions: 60000,
    lifetimeMatch: 15000,
    isCurrentYear: true,
    isFinalized: false,
  },
];

const accountRows: AccountRow[] = [
  {
    id: 11,
    institution: "Fidelity",
    accountLabel: "401(k)",
    ownerName: "Alice",
    ownerPersonId: 1,
    ownershipType: "individual",
    beginningBalance: 100000,
    totalContributions: 10000,
    yearlyGainLoss: 8000,
    endingBalance: 118000,
    annualReturnPct: 0.08,
    employerContributions: 3000,
    fees: 50,
    distributions: 0,
    rollovers: 0,
    parentCategory: "Retirement",
    accountType: "401k",
    subType: null,
    isActive: true,
    performanceAccountId: 101,
    displayOrder: 0,
    year: 2025,
  },
];

const masterAccounts: MasterAccount[] = [
  {
    id: 101,
    institution: "Fidelity",
    accountLabel: "401(k)",
    ownerName: "Alice",
    ownerPersonId: 1,
    ownershipType: "individual",
    parentCategory: "Retirement",
    accountType: "401k",
    isActive: true,
    displayOrder: 0,
  },
];

function renderTable(
  overrides: Partial<React.ComponentProps<typeof PerformanceTable>> = {},
) {
  const onToggleYear = vi.fn();
  const props: React.ComponentProps<typeof PerformanceTable> = {
    filtered: annualRows,
    accountRows,
    masterAccounts,
    activeCategory: PERF_CATEGORY_RETIREMENT,
    expandedYears: new Set<number>(),
    onToggleYear,
    editingCell: null,
    editValue: "",
    onStartEdit: vi.fn(),
    onEditValueChange: vi.fn(),
    onSaveEdit: vi.fn(),
    onKeyDown: vi.fn(),
    canEdit: true,
    ...overrides,
  };
  render(<PerformanceTable {...props} />);
  return { onToggleYear };
}

describe("PerformanceTable", () => {
  it("renders without crashing and shows the year row", () => {
    renderTable();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    // Column headers
    expect(screen.getByText("Beginning")).toBeInTheDocument();
    expect(screen.getByText("Gain/Loss")).toBeInTheDocument();
  });

  it("does not render account rows until the year is expanded", () => {
    renderTable();
    expect(screen.queryByText("401(k)")).toBeNull();
  });

  it("expands to show account rows when expandedYears includes the year", () => {
    renderTable({ expandedYears: new Set([2025]) });
    expect(screen.getByText("401(k)")).toBeInTheDocument();
  });

  it("calls onToggleYear when the year row is clicked", () => {
    const { onToggleYear } = renderTable();
    fireEvent.click(screen.getByText("2025"));
    expect(onToggleYear).toHaveBeenCalledWith(2025);
  });

  it("omits Cost Basis / Unrealized columns outside the Brokerage category", () => {
    renderTable();
    expect(screen.queryByText("Cost Basis")).toBeNull();
    expect(screen.queryByText("Unrealized")).toBeNull();
  });
});
