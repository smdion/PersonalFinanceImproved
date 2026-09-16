import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/layout/sidebar";

// Mock DataFreshness (uses tRPC internally)
vi.mock("@/components/layout/data-freshness", () => ({
  DataFreshness: ({ compact }: { compact?: boolean }) => (
    <div data-testid="data-freshness">{compact ? "compact" : "full"}</div>
  ),
}));

// Mock ThemeToggle (uses useTheme internally)
vi.mock("@/components/ui/theme-toggle", () => ({
  ThemeToggle: ({ compact }: { compact?: boolean }) => (
    <div data-testid="theme-toggle">{compact ? "compact" : "full"}</div>
  ),
}));

// BudgetApiLink (rendered inline in Sidebar, not a separate importable
// component) uses tRPC internally — mock the one query it calls so these
// tests don't need a full tRPC provider wrapper.
const mockGetActiveBudgetApiLink = vi.fn().mockReturnValue({
  data: { service: "none", url: null },
});
vi.mock("@/lib/trpc", () => ({
  trpc: {
    sync: {
      getActiveBudgetApiLink: {
        useQuery: () => mockGetActiveBudgetApiLink(),
      },
    },
  },
}));

const defaultProps = {
  user: { name: "Admin", role: "admin" },
  mobileOpen: false,
  onMobileClose: vi.fn(),
  collapsed: false,
  onToggleCollapse: vi.fn(),
};

describe("Sidebar", () => {
  it("renders the app name", () => {
    render(<Sidebar {...defaultProps} />);
    // "Ledgr" appears in both mobile and desktop spans
    expect(screen.getAllByText("Ledgr").length).toBeGreaterThan(0);
  });

  it("renders user name and role", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("Admin (admin)")).toBeInTheDocument();
  });

  it("renders the Dashboard nav item", () => {
    render(<Sidebar {...defaultProps} />);
    // Sidebar renders duplicate items for mobile/desktop breakpoints
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("renders nav groups", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getAllByText("Cash Flow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Investments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Net Worth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Analysis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
  });

  it("expands a group when clicked", () => {
    render(<Sidebar {...defaultProps} />);

    // Cash Flow group should be collapsed by default (not active)
    expect(screen.queryByText("Paycheck")).toBeNull();

    // Click to expand — use first match (desktop sidebar)
    fireEvent.click(screen.getAllByText("Cash Flow")[0]!);
    expect(screen.getAllByText("Paycheck").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Budget").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expenses").length).toBeGreaterThan(0);
  });

  it("collapses a group when clicked again", () => {
    render(<Sidebar {...defaultProps} />);

    fireEvent.click(screen.getAllByText("Cash Flow")[0]!);
    expect(screen.getAllByText("Paycheck").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Cash Flow")[0]!);
    expect(screen.queryByText("Paycheck")).toBeNull();
  });

  it("renders DataFreshness and ThemeToggle", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByTestId("data-freshness")).toBeInTheDocument();
    // ThemeToggle renders twice: once for mobile, once for desktop utility bar
    expect(screen.getAllByTestId("theme-toggle").length).toBe(2);
  });

  it("shows collapse button", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
  });

  describe("budget API link", () => {
    it("is hidden when no budget API is active", () => {
      mockGetActiveBudgetApiLink.mockReturnValueOnce({
        data: { service: "none", url: null },
      });
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByText("YNAB")).not.toBeInTheDocument();
      expect(screen.queryByText("Actual Budget")).not.toBeInTheDocument();
    });

    it("is hidden when Actual is active but has no saved External URL", () => {
      mockGetActiveBudgetApiLink.mockReturnValueOnce({
        data: { service: "actual", url: null },
      });
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByText("Actual Budget")).not.toBeInTheDocument();
    });

    it("links to the hosted app when YNAB is active", () => {
      mockGetActiveBudgetApiLink.mockReturnValueOnce({
        data: { service: "ynab", url: "https://app.youneedabudget.com/" },
      });
      render(<Sidebar {...defaultProps} />);
      // Renders twice (mobile + desktop spans), same as every other nav item.
      const link = screen.getAllByText("YNAB")[0]!.closest("a");
      expect(link).toHaveAttribute("href", "https://app.youneedabudget.com/");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("links to the saved External URL when Actual is active", () => {
      mockGetActiveBudgetApiLink.mockReturnValueOnce({
        data: { service: "actual", url: "https://actual.mydomain.com" },
      });
      render(<Sidebar {...defaultProps} />);
      const link = screen.getAllByText("Actual Budget")[0]!.closest("a");
      expect(link).toHaveAttribute("href", "https://actual.mydomain.com");
    });
  });
});
