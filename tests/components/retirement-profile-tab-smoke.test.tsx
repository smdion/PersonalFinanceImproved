import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Smoke test for RetirementProfileTab — the "Projection Assumptions" card
// relocated from the Retirement page to the Budget page's Retirement
// Profile tab in v0.7.8 (PLAN-v0.7.8-v4 Group A). Verifies the moved
// content renders with real-shaped data and that the isAdmin gate (Group B)
// survived the move: admin sees editable controls, non-admin sees the same
// values read-only. Child components stubbed so we don't pull in recharts
// or hit the engine — same pattern as retirement-content-smoke.test.tsx.

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

vi.mock("@/components/cards/strategy-guide-panel", () => ({
  StrategyGuideButton: () => null,
}));

vi.mock("@/components/cards/dashboard/utils", () => ({
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));
vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useActiveSalaries: () => [],
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
  socialSecurityMonthly: "2000",
  ssStartAge: 67,
  taxMultiplier: "1.0",
};

const mockProjectionData = {
  settings: mockSettings,
  people: [{ id: 1, name: "Alice", birthYear: 1990 }],
  perPersonSettings: null,
  returnRateSummary: null,
  selectedScenario: null,
  combinedSalary: 100000,
  salaryByPerson: { 1: 100000 },
  accumulationBudgetProfileId: null,
  accumulationBudgetColumn: 0,
  decumulationBudgetProfileId: null,
  decumulationBudgetColumn: 0,
  budgetProfileSummaries: [],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      retirement: { invalidate: vi.fn() },
      projection: {
        invalidate: vi.fn(),
        computeProjection: { cancel: vi.fn(), setData: vi.fn() },
      },
    }),
    contributionProfile: { list: { useQuery: () => ({ data: [] }) } },
    salaryProfile: { list: { useQuery: () => ({ data: [] }) } },
    projection: {
      computeProjection: {
        useQuery: () => ({
          data: mockProjectionData,
          isLoading: false,
          error: null,
        }),
      },
      // Multi-year withdrawal-policy optimizer, Phase 4 — retirement-
      // profile-tab.tsx queries this directly (TaxesSection is a pure
      // presentational leaf, see retirement-sections-smoke.test.tsx) and
      // passes the result down as a prop. `data: undefined` here matches
      // "query hasn't resolved yet" -- TaxesSection renders no
      // recommendation either way, so this smoke test's assertions are
      // unaffected.
      computeWithdrawalBracketOptimizer: {
        useQuery: () => ({ data: undefined }),
      },
    },
    retirement: {
      retirementSettings: {
        upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        upsertPersonRaiseRate: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
      retirementProfilePeople: {
        upsertPerson: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        upsertHouseholdFields: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
  },
}));

describe("RetirementProfileTab smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = "admin";
  });

  it("renders the relocated Projection Assumptions content", async () => {
    const { RetirementProfileTab } =
      await import("@/components/retirement/retirement-profile-tab");
    render(<RetirementProfileTab />);
    expect(screen.getByText("Projection Assumptions")).toBeInTheDocument();
    expect(screen.getByText("Decumulation Plan")).toBeInTheDocument();
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
