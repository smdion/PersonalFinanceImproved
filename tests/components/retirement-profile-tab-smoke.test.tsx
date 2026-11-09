import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  holdMutation,
  resetTrpcMock,
  setQuery,
  type MockOutput,
} from "./trpc-mock";

// Smoke test for RetirementProfileTab — the "Projection Assumptions" card
// relocated from the Retirement page to the Budget page's Retirement
// Profile tab. Verifies the moved content renders with real-shaped data
// and that the isAdmin gate survived the move: admin sees editable
// controls, non-admin sees the same
// values read-only. Child components stubbed so we don't pull in recharts
// or hit the engine — same pattern as retirement-content-smoke.test.tsx.

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

vi.mock("@/components/retirement/strategy-guide-panel", () => ({
  StrategyGuideButton: () => null,
}));

vi.mock("@/components/dashboard/utils", () => ({
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: <T,>(_key: string, initial: T) => [initial, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-contrib-profile", () => ({
  useActiveContributionProfile: () => [null, vi.fn()],
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
  socialSecurityMonthly: "2000",
  ssStartAge: 67,
  taxMultiplier: "1.0",
};

const mockProjectionData = {
  settings: mockSettings,
  people: [{ id: 1, name: "Alice", birthYear: 1990 }],
  perPersonSettings: null,
  // The server always sends a summary; an empty schedule is the least one.
  returnRateSummary: {
    currentRate: null,
    retirementRate: null,
    postRetirementRate: null,
    avgAccumulation: 0.07,
    schedule: [],
  },
  selectedScenario: null,
  combinedSalary: 100000,
  salaryByPerson: { 1: 100000 },
  accumulationBudgetProfileId: null,
  accumulationBudgetColumn: 0,
  decumulationBudgetProfileId: null,
  decumulationBudgetColumn: 0,
  budgetProfileSummaries: [],
};

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

describe("RetirementProfileTab smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = "admin";
    resetTrpcMock();
    setQuery("settings.appSettings.list", []);
    setQuery("contributionProfile.list", []);
    setQuery("salaryProfile.list", []);
    // The fixture is a partial projection with the stored-row field types.
    setQuery(
      "projection.getProjectionMetadata",
      mockProjectionData as MockOutput<"projection.getProjectionMetadata">,
    );
    // retirement-profile-tab.tsx queries this directly (TaxesSection is a pure
    // presentational leaf, see retirement-sections-smoke.test.tsx) and
    // passes the result down as a prop. No data here matches "query hasn't
    // resolved yet" -- TaxesSection renders no recommendation either way, so
    // this smoke test's assertions are unaffected.
    setQuery("projection.computeWithdrawalBracketOptimizer", undefined);
    // RMD Handling's "Reinvested into" picker lists Retirement brokerages.
    setQuery("performance.performanceAccounts.list", []);
    // No write settled before (no onSuccess): keep it so.
    for (const path of [
      "retirement.retirementSettings.upsert",
      "retirement.retirementSettings.upsertPersonRaiseRate",
      "retirement.retirementProfilePeople.upsertPerson",
      "retirement.retirementProfilePeople.upsertHouseholdFields",
    ] as const)
      holdMutation(path);
  });

  it("renders the relocated Projection Assumptions content", async () => {
    const { RetirementProfileTab } =
      await import("@/components/retirement/retirement-profile-tab");
    render(<RetirementProfileTab />);
    expect(screen.getByText("Projection Assumptions")).toBeInTheDocument();
    expect(
      screen.getByText("Retirement budget and strategy"),
    ).toBeInTheDocument();
    expect(screen.getByText("Plan Assumptions")).toBeInTheDocument();
    expect(screen.getByText("Taxes in Retirement")).toBeInTheDocument();
  });

  it("admin: strategy select and tax controls are enabled", async () => {
    currentRole = "admin";
    const { RetirementProfileTab } =
      await import("@/components/retirement/retirement-profile-tab");
    render(<RetirementProfileTab />);
    for (const sel of screen.getAllByRole("combobox")) {
      expect(sel).not.toBeDisabled();
    }
  });

  it("non-admin: strategy select and tax controls render disabled, values still visible", async () => {
    currentRole = "viewer";
    const { RetirementProfileTab } =
      await import("@/components/retirement/retirement-profile-tab");
    render(<RetirementProfileTab />);
    // Withdrawal Strategy select (retirementSettings.upsert-backed).
    const strategySelect = screen.getByDisplayValue("Fixed Real");
    expect(strategySelect).toBeDisabled();
    // Filing-status select inside TaxesSection is also upsert-backed.
    for (const btn of screen.getAllByRole("button", { name: "Off" })) {
      expect(btn).toBeDisabled();
    }
    // Values remain visible — read-only, not hidden.
    expect(screen.getByText("Taxes in Retirement")).toBeInTheDocument();
  });
});
