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
 * budget.computeActiveSummary answers with one column, and the budget table
 * (own file) is a stub that reads and writes one item's draft through the
 * row handlers. The tab's pickers, sandbox state, reset and save actions run
 * for real on mocked tRPC.
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
/** The paycheck inputs of renders React committed (a render it threw away,
 *  as when state is adjusted while rendering, never reaches an effect). */
const committedPaycheckInputs: unknown[] = [];
vi.mock("@/lib/hooks/use-paycheck-person-views", async () => {
  const { useEffect } = await import("react");
  return {
    usePaycheckPersonViews: (opts: unknown) => {
      useEffect(() => {
        committedPaycheckInputs.push(opts);
      });
      return paycheckViews(opts);
    },
  };
});
vi.mock("@/components/profiles/what-if/what-if-paycheck-summary", () => ({
  WhatIfPaycheckSummary: () => <div data-testid="paycheck-summary" />,
}));
type StubRowHandlers = {
  getDraft: (id: number, colIndex: number, original: number) => number;
  setDraft: (id: number, colIndex: number, amount: number) => void;
};
vi.mock("@/components/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/budget")>()),
  BudgetTable: ({ rowHandlers }: { rowHandlers: StubRowHandlers }) => (
    <div>
      <span data-testid="groceries-draft">
        {rowHandlers.getDraft(11, 0, 500)}
      </span>
      <button type="button" onClick={() => rowHandlers.setDraft(11, 0, 640)}>
        Draft groceries
      </button>
    </div>
  ),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { WhatIfTab } from "@/components/profiles/what-if/what-if-tab";

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  paycheckViews.mockClear();
  committedPaycheckInputs.length = 0;
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
  setQuery("budget.computeActiveSummary", {
    columnLabels: ["Standard"],
    allColumnResults: [{ totalMonthly: 4000 }],
    rawItems: [],
  });
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

  it("names each salary and bonus cell by its column and person", () => {
    renderTab();
    for (const name of ["Priya", "Tomas"])
      for (const column of ["Salary", "Bonus %", "Bonus ×"])
        expect(
          screen.getByRole("spinbutton", { name: `${column}, ${name}` }),
        ).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^save as plan$/i }));
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

  /** One draft of each kind: Priya's salary, the groceries amount and a
   *  hand-added deduction for Priya. */
  const draftEverything = () => {
    fireEvent.change(salaryInput("Priya"), { target: { value: "130000" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft groceries" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "+ Add deduction" })[0]!,
    );
    expect(screen.getByTestId("groceries-draft")).toHaveTextContent("640");
    expect(screen.getByDisplayValue("New deduction")).toBeInTheDocument();
  };
  const pick = (label: string, id: number) =>
    fireEvent.change(
      screen.getByRole("combobox", { name: `${label} profile` }),
      {
        target: { value: String(id) },
      },
    );

  it("switching the salary profile clears the salary edits and keeps every other draft", () => {
    renderTab();
    draftEverything();
    pick("Salary", 8);

    expect(salaryInput("Priya")).toHaveValue(118000);
    expect(paycheckViews.mock.lastCall![0]).toMatchObject({
      salaryProfileId: 8,
    });
    expect(
      (paycheckViews.mock.lastCall![0] as { sandboxSalaryEntries: unknown })
        .sandboxSalaryEntries,
    ).toEqual({});
    expect(screen.getByTestId("groceries-draft")).toHaveTextContent("640");
    expect(
      screen.getByRole("button", { name: /\(1 edited amount\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("New deduction")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset sandbox/i }),
    ).toBeInTheDocument();
  });

  it("switching the budget profile clears the budget amounts and keeps every other draft", () => {
    renderTab();
    draftEverything();
    pick("Budget", 2);

    expect(screen.getByTestId("groceries-draft")).toHaveTextContent("500");
    expect(
      screen.getByRole("button", { name: "Duplicate Profile" }),
    ).toBeInTheDocument();
    expect(salaryInput("Priya")).toHaveValue(130000);
    expect(paycheckViews.mock.lastCall![0]).toMatchObject({
      sandboxSalaryEntries: { "1": { salary: 130000 } },
    });
    expect(screen.getByDisplayValue("New deduction")).toBeInTheDocument();
  });

  it("switching the contribution profile clears no draft", () => {
    renderTab();
    draftEverything();
    pick("Contribution", 5);

    expect(salaryInput("Priya")).toHaveValue(130000);
    expect(paycheckViews.mock.lastCall![0]).toMatchObject({
      contributionProfileId: 5,
      sandboxSalaryEntries: { "1": { salary: 130000 } },
    });
    expect(screen.getByTestId("groceries-draft")).toHaveTextContent("640");
    expect(screen.getByDisplayValue("New deduction")).toBeInTheDocument();
  });

  it("no render pairs a newly picked profile with the old profile's drafts", () => {
    renderTab();
    draftEverything();
    committedPaycheckInputs.length = 0;
    pick("Salary", 8);

    const calls = committedPaycheckInputs as {
      salaryProfileId: number;
      sandboxSalaryEntries: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);
    for (const opts of calls) {
      expect(opts.salaryProfileId).toBe(8);
      expect(opts.sandboxSalaryEntries).toEqual({});
    }
  });
});
