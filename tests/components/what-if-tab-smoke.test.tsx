/* eslint-disable no-restricted-syntax -- as unknown as casts build partial paycheck views (the tab reads person, job, salary, bonus terms and the contribution figures) */
/**
 * Tab-level smoke test before the split of budget/what-if-tab.tsx (RULES §
 * Refactoring: smoke tests before any split; target-architecture § 8.7: tab
 * smoke, reset behavior). A dated temporary net: the split that replaces the
 * file replaces this test. The editors themselves are covered by
 * what-if-editors.test.tsx.
 *
 * Seam: `usePaycheckPersonViews` (a whole paycheck.computeSummary and
 * contribution.computeSummary per person) is stood in by two invented
 * people's views, and the paycheck summary table (own file) is a stub.
 * budget.computeActiveSummary has no answer, so step 3 shows its picked
 * profile without a budget table. The tab's pickers, sandbox state, reset and save actions run for
 * real on mocked tRPC.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { formatCurrency } from "@/lib/utils/format";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const view = (
  id: number,
  name: string,
  salary: number,
  contrib: { annual: number; match: number },
) =>
  ({
    person: { id, name },
    job: { id: id * 10 },
    salary,
    resolvedBonusTerms: { bonusPercent: 0.05, bonusMultiplier: 1 },
    perContribData: [
      { annualAmount: contrib.annual, employerMatchAnnual: contrib.match },
    ],
    rawDeductions: [],
    rawContribs: [],
  }) as unknown as PaycheckPersonView;

const views = [
  view(1, "Priya", 118000, { annual: 14160, match: 3540 }),
  view(2, "Tomas", 76000, { annual: 4560, match: 2280 }),
];
const paycheckViews = vi.fn((_opts: unknown) => ({
  views,
  isLoading: false,
}));
vi.mock("@/lib/hooks/use-paycheck-person-views", () => ({
  usePaycheckPersonViews: (opts: unknown) => paycheckViews(opts),
}));
vi.mock("@/app/(dashboard)/budget/what-if-paycheck-summary", () => ({
  WhatIfPaycheckSummary: () => <div data-testid="paycheck-summary" />,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { WhatIfTab } from "@/app/(dashboard)/budget/what-if-tab";

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  paycheckViews.mockClear();
  setQuery("settings.appSettings.list", [
    { key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: 4 },
    { key: SK_ACTIVE_SALARY_PROFILE_ID, value: 7 },
    { key: SK_ACTIVE_RETIREMENT_PROFILE_ID, value: 9 },
  ]);
  setQuery("budget.listProfiles", [
    { id: 2, name: "Lean Year", isActive: false },
    { id: 3, name: "Household 2026", isActive: true },
  ]);
  setQuery("contributionProfile.list", [
    { id: 4, name: "Current Jobs" },
    { id: 5, name: "Max Everything" },
  ]);
  setQuery("salaryProfile.list", [
    { id: 7, name: "This Year" },
    { id: 8, name: "Priya Promotion" },
  ]);
  setQuery("retirement.retirementProfiles.list", [
    { id: 9, name: "Retire at 60" },
  ]);
});

const renderTab = () =>
  render(
    <TooltipProvider>
      <WhatIfTab canDuplicateProfile canCreatePlan canManagePaycheck={false} />
    </TooltipProvider>,
  );

/** The salary input on a person's row in step 1. */
const salaryInput = (name: string) =>
  within(screen.getByText(name).closest("tr")!).getAllByRole("spinbutton")[0]!;

describe("WhatIfTab smoke", () => {
  it("starts from the active profiles and shows the three steps", () => {
    renderTab();
    expect(screen.getAllByText(/This Year/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Current Jobs/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Household 2026/).length).toBeGreaterThan(0);
    // Step 1: each person's live salary.
    expect(salaryInput("Priya")).toHaveValue(118000);
    expect(salaryInput("Tomas")).toHaveValue(76000);
    expect(screen.getByTestId("paycheck-summary")).toBeInTheDocument();
    // Step 2: the picked contribution profile's totals.
    expect(document.body).toHaveTextContent(`${formatCurrency(18720)}/yr`);
    expect(document.body).toHaveTextContent(`${formatCurrency(5820)}/yr`);
    // Nothing edited yet: no reset offered.
    expect(screen.queryByRole("button", { name: /reset sandbox/i })).toBeNull();
  });

  it("an edit reaches the paycheck recompute; Reset sandbox puts it back", () => {
    renderTab();
    fireEvent.change(salaryInput("Priya"), { target: { value: "130000" } });
    expect(salaryInput("Priya")).toHaveValue(130000);
    expect(paycheckViews.mock.lastCall![0]).toMatchObject({
      sandboxSalaryEntries: { "1": { salary: 130000 } },
    });

    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    expect(salaryInput("Priya")).toHaveValue(118000);
    expect(paycheckViews.mock.lastCall![0]).toMatchObject({
      sandboxSalaryEntries: {},
    });
    expect(screen.queryByRole("button", { name: /reset sandbox/i })).toBeNull();
  });

  it("Save as Plan saves the picked profiles with the active retirement profile", () => {
    renderTab();
    fireEvent.change(screen.getByRole("textbox", { name: "New Plan name" }), {
      target: { value: "Promotion test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save as plan/i }));
    expect(mutationCalls("settings.scenarios.create")).toEqual([
      {
        name: "Promotion test",
        salaryProfileId: 7,
        contributionProfileId: 4,
        budgetProfileId: 3,
        retirementProfileId: 9,
      },
    ]);
  });
});
