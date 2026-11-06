import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  holdMutation,
  resetTrpcMock,
  setQuery,
  type MockOutput,
} from "./trpc-mock";

// Smoke test for RetirementContent — asserts the 3 tabs render, key KPI labels
// appear (rendered via the mocked ProjectionCard), and tab switching works.
// Child components are stubbed so we don't pull in recharts or hit the engine.

vi.mock("@/components/cards/projection", () => ({
  ProjectionCard: () => <div data-testid="projection-card" />,
}));

vi.mock("@/components/cards/withdrawal-comparison", () => ({
  WithdrawalComparisonCard: () => (
    <div data-testid="withdrawal-comparison">Comparison</div>
  ),
}));

vi.mock("@/components/cards/plan-health", () => ({
  PlanHealthCard: () => (
    <div data-testid="plan-health">Plan Health Content</div>
  ),
}));

vi.mock("@/components/cards/strategy-guide-panel", () => ({
  StrategyGuideButton: () => null,
}));

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

// Phase 4 assumptions band — stubbed like the other cards above, this
// smoke test is about tab structure, not the band's own content (covered
// separately if/when it gets its own smoke test).
vi.mock("@/components/retirement/assumptions-band", () => ({
  AssumptionsBand: () => <div data-testid="assumptions-band" />,
}));

vi.mock("@/lib/hooks/use-active-retirement-profile", () => ({
  useActiveRetirementProfile: () => [null, vi.fn()],
}));

vi.mock("@/components/cards/dashboard/utils", () => ({
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
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

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({ value }: { value: string }) => <span>{value}</span>,
  InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  SkeletonChart: () => <div data-testid="skeleton-chart" />,
}));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));
vi.mock("@/lib/hooks/use-plan-engine-input", () => ({
  usePlanEngineInput: () => ({
    input: {
      selection: {},
      decumulationDefaults: { withdrawalTaxPreference: {} },
    },
    ready: true,
    ids: {
      contributionProfileId: null,
      salaryProfileId: null,
      retirementProfileId: null,
      snapshotId: null,
    },
  }),
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: <T,>(_key: string, initial: T) => [initial, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-contrib-profile", () => ({
  useActiveContribProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-salary-profile", () => ({
  useActiveSalaryProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ activeScenario: null }),
}));

const mockSettings = {
  personId: 1,
  profileId: 1,
  retirementAge: 65,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.03",
  salaryAnnualIncrease: "0.03",
  salaryCap: null,
  withdrawalStrategy: "fixed",
  withdrawalRate: "0.04",
  filingStatus: "single",
  postRetirementInflation: "0.03",
};

const mockProjectionData = {
  settings: mockSettings,
  people: [{ id: 1, name: "Alice", birthYear: 1990 }],
  perPersonSettings: [
    {
      personId: 1,
      name: "Alice",
      birthYear: 1990,
      retirementAge: 65,
      endAge: 95,
    },
  ],
  returnRateSummary: null,
  selectedScenario: null,
  combinedSalary: 100000,
  accumulationBudgetProfileId: null,
  accumulationBudgetColumn: 0,
  decumulationBudgetProfileId: null,
  decumulationBudgetColumn: 0,
  budgetProfileSummaries: [],
  planHealth: null,
  result: { projectionByYear: [] },
};

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

/** What computeStrategyComparison returns (null = nothing yet). */
const COMPARISON = "projection.computeStrategyComparison";

describe("RetirementContent smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrpcMock();
    setQuery("contributionProfile.list", []);
    // The independent Salary Profile axis (useActiveSalaryProfile). An empty
    // list is the "nothing to resolve" case: the hook leaves the active id
    // alone rather than re-pointing it.
    setQuery("salaryProfile.list", []);
    setQuery("networth.listSnapshotTotals", []);
    // The fixture is a partial projection with the stored-row field types,
    // which the procedure's (serialized) output type doesn't have.
    const projection: unknown = mockProjectionData;
    setQuery(
      "projection.getProjectionMetadata",
      projection as MockOutput<"projection.getProjectionMetadata">,
    );
    setQuery(COMPARISON, null);
    setQuery("retirement.retirementProfiles.list", []);
    // No write settled before (no onSuccess): keep it so.
    for (const path of [
      "retirement.retirementSettings.upsert",
      "retirement.retirementProfilePeople.upsertPerson",
      "retirement.retirementProfilePeople.upsertHouseholdFields",
    ] as const)
      holdMutation(path);
  });

  it("the comparison tab says to set a return rate when none is set, not Loading", async () => {
    setQuery(COMPARISON, {
      strategies: [],
      activeStrategy: null,
      notConfigured: "no_return_rate",
    });
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    fireEvent.click(
      screen.getByRole("button", { name: "Strategy Comparison" }),
    );
    expect(screen.getByText(/Set a return rate first/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Set return rates" }),
    ).toHaveAttribute("href", expect.stringContaining("section=returns"));
    expect(screen.queryByText(/Loading strategy comparison/)).toBeNull();
  });

  it("renders the 3 main tabs", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    expect(
      screen.getByRole("button", { name: "Projection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Strategy Comparison" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Plan Health" }),
    ).toBeInTheDocument();
  });

  it("switches between tabs", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    // Default tab shows projection card
    expect(screen.getByTestId("projection-card")).toBeInTheDocument();

    // Switch to Plan Health tab
    fireEvent.click(screen.getByRole("button", { name: "Plan Health" }));
    expect(screen.getByTestId("plan-health")).toBeInTheDocument();
    expect(screen.queryByTestId("projection-card")).toBeNull();
  });

  it("shows the shared disclaimer under the projection; Plan Health's card has its own", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    const disclaimer =
      "Estimates from the figures and assumptions you entered. Not financial, tax or legal advice.";
    expect(screen.getByText(disclaimer)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plan Health" }));
    // The stubbed card stands in for the real one, which renders it.
    expect(screen.queryByText(disclaimer)).toBeNull();
  });
});
