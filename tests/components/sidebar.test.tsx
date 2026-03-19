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
    expect(screen.getAllByText("Income").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Investments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Property").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Planning").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
  });

  it("expands a group when clicked", () => {
    render(<Sidebar {...defaultProps} />);

    // Income group should be collapsed by default (not active)
    expect(screen.queryByText("Paycheck")).toBeNull();

    // Click to expand — use first match (desktop sidebar)
    fireEvent.click(screen.getAllByText("Income")[0]!);
    expect(screen.getAllByText("Paycheck").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Budget").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expenses").length).toBeGreaterThan(0);
  });

  it("collapses a group when clicked again", () => {
    render(<Sidebar {...defaultProps} />);

    fireEvent.click(screen.getAllByText("Income")[0]!);
    expect(screen.getAllByText("Paycheck").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Income")[0]!);
    expect(screen.queryByText("Paycheck")).toBeNull();
  });

  it("renders DataFreshness and ThemeToggle", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByTestId("data-freshness")).toBeInTheDocument();
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  it("shows collapse button", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument();
  });
});
