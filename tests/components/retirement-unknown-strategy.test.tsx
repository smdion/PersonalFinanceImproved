import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setQuery,
  type MockOutput,
} from "./trpc-mock";
import { makeSettings } from "./fixtures/retirement-settings";

// A stored withdrawal strategy that names no current strategy (a restored
// backup can carry one): the Retirement settings tab and the assumptions
// band show their strategy picker with nothing selected and a note naming
// the key, render none of the strategy's sections, and save a pick through
// retirementSettings.upsert. A known key renders as before.

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
vi.mock("@/components/ui/edit-lock-toggle", () => ({
  EDIT_LOCK_KEYS: { profileEditLocked: "profile-edit-locked" },
  EditLockToggle: () => null,
  useEditLock: () => [false, vi.fn()],
}));
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
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const settingsWith = (withdrawalStrategy: string) => ({
  personId: 1,
  profileId: 1,
  retirementAge: 65,
  endAge: 95,
  ownRetirementAge: 65,
  ownEndAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.03",
  salaryAnnualIncrease: "0.03",
  salaryCap: null,
  withdrawalStrategy,
  withdrawalRate: "0.04",
  filingStatus: null,
  postRetirementInflation: "0.03",
  socialSecurityMonthly: "2000",
  ssStartAge: 67,
  taxMultiplier: "1.0",
});

const metadataWith = (withdrawalStrategy: string) => ({
  settings: settingsWith(withdrawalStrategy),
  people: [{ id: 1, name: "Robin", birthYear: 1985 }],
  perPersonSettings: null,
  returnRateSummary: {
    currentRate: null,
    retirementRate: null,
    postRetirementRate: null,
    avgAccumulation: 0.07,
    schedule: [],
  },
  selectedScenario: null,
  combinedSalary: 90000,
  salaryByPerson: { 1: 90000 },
  accumulationBudgetProfileId: null,
  accumulationBudgetColumn: 0,
  decumulationBudgetProfileId: null,
  decumulationBudgetColumn: 0,
  budgetProfileSummaries: [
    {
      id: 1,
      name: "Household budget",
      isActive: true,
      columnLabels: ["Standard"],
      columnTotals: [48000],
      columnMonths: null,
      weightedAnnualTotal: null,
    },
  ],
});

const NOTE =
  "Your saved strategy (retired_strategy) isn't one Ledgr has now; pick one.";

/** The select holding the strategy options. */
function strategySelect(): HTMLSelectElement {
  const select = screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .find((s) => within(s).queryByRole("option", { name: /Fixed Real/ }));
  if (!select) throw new Error("no strategy select");
  return select;
}

async function renderTab(withdrawalStrategy: string) {
  setQuery(
    "projection.getProjectionMetadata",
    metadataWith(
      withdrawalStrategy,
    ) as MockOutput<"projection.getProjectionMetadata">,
  );
  const { RetirementProfileTab } =
    await import("@/components/retirement/retirement-profile-tab");
  return render(<RetirementProfileTab />);
}

async function renderBand(withdrawalStrategy: string) {
  const { AssumptionsBand } =
    await import("@/components/retirement/assumptions-band");
  return render(
    <AssumptionsBand
      settings={makeSettings({ withdrawalStrategy })}
      perPersonSettings={null}
      profiles={[{ id: 1, name: "Plan" }]}
      activeProfileId={1}
      onActivate={vi.fn()}
      admin={currentRole === "admin"}
    />,
  );
}

describe("a stored withdrawal strategy Ledgr doesn't have", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = "admin";
    resetTrpcMock();
    setQuery("settings.appSettings.list", []);
    setQuery("contributionProfile.list", []);
    setQuery("salaryProfile.list", []);
    setQuery("projection.computeWithdrawalBracketOptimizer", undefined);
    setQuery("performance.performanceAccounts.list", []);
    for (const path of [
      "retirement.retirementSettings.upsert",
      "retirement.retirementSettings.upsertPersonRaiseRate",
      "retirement.retirementProfilePeople.upsertPerson",
      "retirement.retirementProfilePeople.upsertHouseholdFields",
    ] as const)
      holdMutation(path);
  });

  it("settings tab: the picker selects nothing, names the key, and hides the strategy's sections", async () => {
    await renderTab("retired_strategy");
    const select = strategySelect();
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.disabled).toBe(true);
    expect(select).not.toBeDisabled();
    expect(screen.getByText(/Your saved strategy/).textContent).toBe(NOTE);
    expect(screen.queryByText("Post-Retirement Raise")).toBeNull();
    expect(screen.queryByText("Budget Source")).toBeNull();
    // The rest of the tab still renders.
    expect(screen.getByText("Plan Assumptions")).toBeInTheDocument();
    expect(screen.getByText("Taxes in Retirement")).toBeInTheDocument();
  });

  it("settings tab: a pick saves through retirementSettings.upsert", async () => {
    await renderTab("retired_strategy");
    fireEvent.change(strategySelect(), { target: { value: "guyton_klinger" } });
    expect(mutationCalls("retirement.retirementSettings.upsert")).toEqual([
      {
        personId: 1,
        profileId: 1,
        retirementAge: 65,
        endAge: 95,
        returnAfterRetirement: "0.05",
        annualInflation: "0.03",
        salaryAnnualIncrease: "0.03",
        withdrawalStrategy: "guyton_klinger",
      },
    ]);
  });

  it("settings tab, not an admin: the note shows and the picker stays disabled", async () => {
    currentRole = "viewer";
    await renderTab("retired_strategy");
    expect(strategySelect()).toBeDisabled();
    expect(screen.getByText(/Your saved strategy/).textContent).toBe(NOTE);
  });

  it("settings tab: a known key selects it, with its sections and no note", async () => {
    await renderTab("fixed");
    expect(strategySelect().value).toBe("fixed");
    expect(screen.queryByText(/Your saved strategy/)).toBeNull();
    expect(screen.getByText("Post-Retirement Raise")).toBeInTheDocument();
    expect(screen.getByText("Budget Source")).toBeInTheDocument();
  });

  it("assumptions band: nothing selected, the note, no rate chips; a pick saves", async () => {
    await renderBand("retired_strategy");
    const select = strategySelect();
    expect(select.value).toBe("");
    expect(screen.getByText(/Your saved strategy/).textContent).toBe(NOTE);
    expect(screen.queryByText("Withdrawal Rate")).toBeNull();
    expect(screen.queryByText("Raise")).toBeNull();
    fireEvent.change(select, { target: { value: "fixed" } });
    expect(mutationCalls("retirement.retirementSettings.upsert")).toEqual([
      expect.objectContaining({ profileId: 1, withdrawalStrategy: "fixed" }),
    ]);
  });

  it("assumptions band, not an admin: the note in place of a label", async () => {
    currentRole = "viewer";
    await renderBand("retired_strategy");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Your saved strategy/).textContent).toBe(NOTE);
  });

  it("assumptions band: a known key shows its chips and no note", async () => {
    await renderBand("fixed");
    expect(strategySelect().value).toBe("fixed");
    expect(screen.getByText("Withdrawal Rate")).toBeInTheDocument();
    expect(screen.queryByText(/Your saved strategy/)).toBeNull();
  });
});
