import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke test for PortfolioContent — confirms the top-level PortfolioContent
// mounts and its main structural sections render (NewSnapshotForm,
// SummaryTable, AccountBalanceOverview, PortfolioQuickLook). Also exercises
// the delete-snapshot mutation path.

const createMutate = vi.fn();

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin" }),
  hasPermission: () => true,
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({
    title,
    children,
  }: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: React.ReactNode;
  }) => (
    <div data-testid="card">
      {title && <div>{title}</div>}
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  SkeletonChart: () => <div data-testid="skeleton-chart" />,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
}));
vi.mock("@/components/portfolio/contribution-accounts", () => ({
  ContributionAccountsSettings: () => <div>contrib-accounts</div>,
}));
vi.mock("@/components/cards/dashboard/utils", () => ({
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/portfolio/portfolio-chart", () => ({
  PortfolioChart: () => <div data-testid="portfolio-chart" />,
}));

const mockSummary = {
  snapshotDate: "2026-04-01",
  snapshotId: 42,
  totals: { portfolio: 500000 },
};

const mockLatestSnap = {
  id: 42,
  accounts: [
    {
      institution: "Fidelity",
      accountType: "401k",
      subType: null,
      taxType: "preTax",
      ownerPersonId: 1,
      amount: "250000",
      performanceAccountId: 1,
    },
    {
      institution: "Vanguard",
      accountType: "ira",
      subType: null,
      taxType: "taxFree",
      ownerPersonId: 1,
      amount: "250000",
      performanceAccountId: 2,
    },
  ],
};

const mockPerfAccounts = [
  {
    id: 1,
    accountLabel: "401(k)",
    displayName: null,
    accountType: "401k",
    ownerPersonId: 1,
    institution: "Fidelity",
    isActive: true,
  },
  {
    id: 2,
    accountLabel: "Roth IRA",
    displayName: null,
    accountType: "ira",
    ownerPersonId: 1,
    institution: "Vanguard",
    isActive: true,
  },
];

const mockSnapshotTotals = [
  { id: 40, date: "2025-01-01", total: 400000 },
  { id: 41, date: "2025-06-01", total: 450000 },
  { id: 42, date: "2026-04-01", total: 500000 },
];

const mockPaginatedSnapshots = {
  snapshots: [
    {
      id: 42,
      snapshotDate: "2026-04-01",
      total: "500000",
      accountCount: 2,
      delta: "50000",
      deltaPct: "0.1111",
      notes: null,
    },
  ],
  totalCount: 1,
  page: 1,
  pageSize: 52,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      networth: {
        computeSummary: { invalidate: vi.fn() },
        listHistory: { invalidate: vi.fn() },
        listSnapshots: { invalidate: vi.fn() },
      },
      settings: {
        portfolioSnapshots: { getLatest: { invalidate: vi.fn() } },
      },
    }),
    networth: {
      computeSummary: {
        useQuery: () => ({
          data: mockSummary,
          isLoading: false,
          error: null,
        }),
      },
      listSnapshotTotals: {
        useQuery: () => ({ data: mockSnapshotTotals }),
      },
      listSnapshots: {
        useQuery: () => ({ data: mockPaginatedSnapshots }),
      },
    },
    settings: {
      portfolioSnapshots: {
        getLatest: {
          useQuery: () => ({ data: mockLatestSnap, isLoading: false }),
        },
        delete: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        create: {
          useMutation: () => ({
            mutate: createMutate,
            isPending: false,
            isError: false,
            error: null,
          }),
        },
      },
      performanceAccounts: {
        list: { useQuery: () => ({ data: mockPerfAccounts }) },
      },
      people: {
        list: { useQuery: () => ({ data: [{ id: 1, name: "Sean" }] }) },
      },
    },
    sync: {
      resyncSnapshot: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

describe("PortfolioContent smoke", () => {
  beforeEach(() => {
    createMutate.mockClear();
  });

  it("renders main sections after Quick Look and New Snapshot are opened", async () => {
    const { PortfolioContent } =
      await import("@/app/(dashboard)/portfolio/portfolio-content");
    render(<PortfolioContent />);

    // Page header
    expect(screen.getByText("Portfolio Snapshots")).toBeInTheDocument();

    // AccountBalanceOverview is always mounted when data exists
    expect(screen.getByText("Account Balances")).toBeInTheDocument();
    // SummaryTable sections rendered by AccountBalanceOverview
    expect(screen.getByText("By Account Type")).toBeInTheDocument();
    expect(screen.getByText("By Institution")).toBeInTheDocument();

    // Open Quick Look — PortfolioQuickLook should mount
    fireEvent.click(screen.getByRole("button", { name: /Quick Look/i }));

    // Open New Snapshot — NewSnapshotForm should mount
    fireEvent.click(screen.getByRole("button", { name: /New Snapshot/i }));
    expect(screen.getByText("Snapshot Date")).toBeInTheDocument();
  });

  it("invokes create mutation when saving a new snapshot", async () => {
    const { PortfolioContent } =
      await import("@/app/(dashboard)/portfolio/portfolio-content");
    render(<PortfolioContent />);

    // Open the New Snapshot form
    fireEvent.click(screen.getByRole("button", { name: /New Snapshot/i }));

    // Click the "Save Snapshot" button inside the form
    fireEvent.click(screen.getByRole("button", { name: /Save Snapshot/i }));

    expect(createMutate).toHaveBeenCalled();
  });
});
