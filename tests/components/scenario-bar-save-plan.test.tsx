/**
 * "Save these profiles as a new Plan" is disabled while a kind has no
 * active profile, and says which kind (planSaveBlockedReason).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PlanProfileKind } from "@/lib/config/plans";

const mocks = vi.hoisted(() => ({
  activeIds: {} as Record<string, number | null>,
}));

// Any procedure: queries return no data (none registered here).
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ viewMode: "plan", setViewMode: vi.fn() }),
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin" }),
  hasPermission: () => true,
  isAdmin: () => true,
}));
vi.mock("@/lib/hooks/use-active-contrib-profile", () => ({
  useActiveContributionProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-salary-profile", () => ({
  useActiveSalaryProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-retirement-profile", () => ({
  useActiveRetirementProfile: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-budget-profiles-list", () => ({
  useBudgetProfilesList: () => ({ data: [] }),
}));
vi.mock("@/lib/hooks/use-plans", () => ({
  useConfirmApplyPlan: () => vi.fn(),
  usePlans: () => ({
    plans: [],
    activeIds: mocks.activeIds,
    planInUse: null,
    lastAppliedPlan: null,
    sameAsActive: false,
    apply: { mutate: vi.fn(), isPending: false, error: null },
  }),
}));

import { ScenarioBar } from "@/components/layout/scenario-bar";

const ALL = { salary: 1, contribution: 2, budget: 3, retirement: 4 };

function openPanel() {
  render(<ScenarioBar />);
  fireEvent.click(screen.getByRole("button", { name: /Profiles and Plans/ }));
  return screen.getByRole("button", {
    name: "+ Save these profiles as a new Plan",
  });
}

beforeEach(() => {
  mocks.activeIds = { ...ALL };
});

describe("Save as a new Plan", () => {
  it("is enabled with no reason when every kind has an active profile", () => {
    const save = openPanel();
    expect(save).not.toBeDisabled();
    expect(save).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/To save a Plan/)).not.toBeInTheDocument();
  });

  it.each<[PlanProfileKind, string]>([
    ["salary", "salary"],
    ["contribution", "contribution"],
    ["budget", "budget"],
    ["retirement", "retirement"],
  ])("names a missing %s profile", (kind, label) => {
    mocks.activeIds = { ...ALL, [kind]: null };
    const save = openPanel();
    expect(save).toBeDisabled();
    const reason = `To save a Plan, make a ${label} profile active first.`;
    expect(save).toHaveAccessibleDescription(reason);
  });

  it("names every missing kind", () => {
    mocks.activeIds = { ...ALL, budget: null, retirement: null };
    expect(openPanel()).toHaveAccessibleDescription(
      "To save a Plan, make a budget and retirement profile active first.",
    );
  });
});
