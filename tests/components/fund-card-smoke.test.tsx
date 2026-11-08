/**
 * Smoke test before the split of the savings page's fund card (RULES §
 * Refactoring: mount, assert key elements, one mutation-plumbing test per
 * write). It pins the expanded card's text with the real formatters for
 * an invented fixed-target fund (linked to a budget API, with sub-goals)
 * and an emergency fund, the read-only view, and each callback's
 * arguments: the actions menu, the target and monthly edits, the target
 * date, Update % and Pull In Pay, and the sub-goal move, delete and add.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type React from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/utils/format";

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="mini-chart" />,
}));
vi.mock("@/components/savings/fund-transaction-list", () => ({
  FundTransactionList: () => <div data-testid="tx-list" />,
}));
vi.mock("@/components/savings/fund-overrides-summary", () => ({
  FundOverridesSummary: () => <div data-testid="overrides" />,
}));
// An inline edit shows its display text; a click saves "750".
vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({
    value,
    onSave,
    formatDisplay,
  }: {
    value: string;
    onSave: (v: string) => void;
    formatDisplay?: (v: string) => React.ReactNode;
  }) => (
    <button type="button" onClick={() => onSave("750")}>
      {formatDisplay ? formatDisplay(value) : value}
    </button>
  ),
}));
const confirmMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/components/ui/confirm-dialog", () => ({ confirm: confirmMock }));

import { FundCard } from "@/components/savings/fund-card";
import type {
  GoalProjection,
  NewFundForm,
  PlannedTransaction,
  RawGoal,
} from "@/components/savings/types";

const m = formatCurrency;

/** `YYYY-MM-DD`, `monthsAhead` calendar months from this one. */
function monthsFromNow(monthsAhead: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
}

const projection: GoalProjection = {
  name: "New Roof",
  goalId: 4,
  current: 6200,
  target: 18000,
  targetMode: "fixed",
  monthlyAllocation: 640,
  monthlyAllocations: [640, 640],
  balances: [6840, 7480],
  monthEvents: [null, null],
  hasOverride: [false, false],
};
const rawGoal: RawGoal = {
  id: 4,
  name: "New Roof",
  monthlyContribution: "640",
  allocationPercent: "16",
  isActive: true,
  isEmergencyFund: false,
  targetDate: monthsFromNow(20),
  targetAmount: "18000",
  targetMode: "fixed",
  parentGoalId: null,
  priority: 2,
  apiCategoryName: "Home: Roof",
  isApiSyncEnabled: true,
};
const savingsGoal = {
  goalId: 4,
  name: "New Roof",
  monthlyAllocation: 640,
  current: 6200,
  target: 18000,
  progress: 6200 / 18000,
  monthsToTarget: 19,
};
const children: RawGoal[] = [
  { ...rawGoal, id: 8, name: "Gutters", targetAmount: "2400", parentGoalId: 4 },
  {
    ...rawGoal,
    id: 9,
    name: "Skylight",
    targetAmount: "1500",
    parentGoalId: 4,
  },
];
const transactions: PlannedTransaction[] = [
  {
    id: 1,
    goalId: 4,
    transactionDate: monthsFromNow(2),
    description: "Inspection",
    amount: -350.5,
    isRecurring: false,
    recurrenceMonths: null,
  },
  {
    id: 2,
    goalId: 4,
    transactionDate: monthsFromNow(-3),
    description: "Old quote",
    amount: -90,
    isRecurring: false,
    recurrenceMonths: null,
  },
  {
    id: 3,
    goalId: 4,
    transactionDate: monthsFromNow(4),
    description: "Rebate",
    amount: 200,
    isRecurring: false,
    recurrenceMonths: null,
  },
];

const fns = () => ({
  onGoalUpdate: vi.fn(),
  onGoalUpdateMulti: vi.fn(),
  onRecalculateAllocation: vi.fn(),
  onLockInAllocationPercent: vi.fn(),
  onDeleteGoal: vi.fn(),
  onDeleteTx: vi.fn(),
  onAddTx: vi.fn(),
  onEditMonth: vi.fn(),
  onDeleteOverride: vi.fn(),
  onTimelineClick: vi.fn(),
  setAddingSubGoalForFund: vi.fn(),
  setNewFund: vi.fn(),
  onCreateFund: vi.fn(),
  onLinkToApi: vi.fn(),
  onUnlinkFromApi: vi.fn(),
  onConvertToBudgetItem: vi.fn(),
  onUpdateParent: vi.fn(),
});
let cb: ReturnType<typeof fns>;
beforeEach(() => {
  cb = fns();
  confirmMock.mockClear();
});

const newFund: NewFundForm = {
  name: "Chimney",
  targetAmount: "800",
  targetMode: "fixed",
  targetDate: "",
  parentGoalId: 4,
};

function mount(over: Partial<React.ComponentProps<typeof FundCard>> = {}) {
  return render(
    <FundCard
      projection={projection}
      rawGoal={rawGoal}
      savingsGoal={savingsGoal}
      savingsGoals={[
        savingsGoal,
        { ...savingsGoal, goalId: 8, name: "Gutters", current: 2400 },
        { ...savingsGoal, goalId: 9, name: "Skylight", current: 450.25 },
      ]}
      transactions={transactions}
      overrides={[]}
      monthDates={[new Date(2026, 10, 1), new Date(2026, 11, 1)]}
      totalMonthlyAllocation={4000}
      maxMonthlyFunding={4000}
      fundColor="#2563eb"
      settledOccurrences={new Set()}
      goalById={new Map()}
      createTxPending={false}
      apiServiceName="ynab"
      apiBalance={{
        balance: 6150.75,
        budgeted: 640,
        activity: -120.4,
        goalTarget: null,
      }}
      addingSubGoalForFund={null}
      newFund={newFund}
      createGoalPending={false}
      canEdit
      availableParents={[
        { id: 4, name: "New Roof" },
        { id: 12, name: "Kitchen" },
      ]}
      defaultExpanded
      {...cb}
      {...over}
    >
      {over.children ?? children}
    </FundCard>,
  );
}

const text = (el: Element) =>
  (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("FundCard smoke", () => {
  it("renders the expanded card's figures with today's formatters", () => {
    const { container } = mount();
    expect(text(container)).toBe(
      [
        `New RoofOn track${m(6200)}${m(640)}/mo⋯`,
        `Home: Roof↓ Balance from YNAB${m(6150.75)}`,
        `↑ Monthly goal pushed to YNAB${m(640)}`,
        `Spent in YNAB${m(-120.4)}`,
        `${m(6200)}/${m(18000)}${m(350.5)} plannedin upcoming expenses`,
        `34%${m(11800)} remaining`,
        `Target date`,
        `Saving${m(640)}/mo(16% of pool)Update %Pull In Pay→ push`,
        `Goals in this fund`,
        `Gutters${m(2400)} / ${m(2400)}↔×`,
        `Skylight${m(450.25)} / ${m(1500)}↔×`,
        `+ Add goal`,
      ].join(""),
    );
    expect(screen.getByTestId("mini-chart")).toBeInTheDocument();
    expect(screen.getByTestId("tx-list")).toBeInTheDocument();
    expect(screen.getByTestId("overrides")).toBeInTheDocument();
  });

  it("an emergency fund shows what is still needed against its target", () => {
    const { container } = mount({
      rawGoal: { ...rawGoal, isEmergencyFund: true, isApiSyncEnabled: false },
      efundResult: {
        neededAfterRepay: 4250,
        targetAmount: 24000,
        progress: 0.8,
      },
      children: [],
    });
    expect(text(container)).toBe(
      [
        `New RoofIn progress${m(4250)}${m(640)}/mo`,
        `still needed${m(4250)}/target${m(24000)}${m(350.5)} plannedin upcoming expenses`,
        `80%${m(4250)} remaining`,
        `Saving${m(640)}/mo(16% of pool)Update %Pull In Pay`,
      ].join(""),
    );
  });

  it("without edit rights: the target date as text, no menu, no edits", () => {
    const { container } = mount({ canEdit: false, apiBalance: null });
    expect(text(container)).toBe(
      [
        `New RoofOn track${m(6200)}${m(640)}/mo`,
        `${m(6200)}/${m(18000)}${m(350.5)} plannedin upcoming expenses`,
        `34%${m(11800)} remaining`,
        `Target date${formatDate(new Date(rawGoal.targetDate + "T00:00:00"), "short")}`,
        `Saving${m(640)}/mo(16% of pool)→ push`,
        `Goals in this fund`,
        `Gutters${m(2400)} / ${m(2400)}`,
        `Skylight${m(450.25)} / ${m(1500)}`,
      ].join(""),
    );
    expect(screen.queryByRole("button")).not.toBeNull(); // the summary row
    expect(screen.queryByText("+ Add goal")).toBeNull();
  });

  it("the actions menu sends each change", async () => {
    mount({ rawGoal: { ...rawGoal, isApiSyncEnabled: false } });
    const open = () => fireEvent.click(screen.getByTitle("Actions"));
    open();
    fireEvent.click(screen.getByText("Link to API"));
    open();
    fireEvent.click(screen.getByText("Set Ongoing"));
    open();
    fireEvent.click(screen.getByText("Set as Bucket"));
    open();
    await act(async () => {
      fireEvent.click(screen.getByText("→ Budget Item"));
    });
    open();
    await act(async () => {
      fireEvent.click(screen.getByText("Delete Fund"));
    });
    expect(cb.onLinkToApi).toHaveBeenCalledWith(4);
    expect(cb.onGoalUpdateMulti.mock.calls).toEqual([
      [4, { targetMode: "ongoing", targetAmount: null, targetDate: null }],
      [
        4,
        {
          targetMode: "bucket",
          targetAmount: null,
          targetDate: null,
          monthlyContribution: "0",
          allocationPercent: null,
        },
      ],
    ]);
    expect(confirmMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'Convert "New Roof" to a budget item? Its monthly funding carries over. This will delete the sinking fund and its history.',
      'Delete "New Roof"?',
    ]);
    expect(cb.onConvertToBudgetItem).toHaveBeenCalledWith(4, "New Roof", false);
    expect(cb.onDeleteGoal).toHaveBeenCalledWith({ id: 4 });
  });

  it("the progress edits send their fields", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: m(18000) }));
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2028-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${m(640)}/mo` }));
    fireEvent.click(screen.getByRole("button", { name: "Update %" }));
    fireEvent.click(screen.getByRole("button", { name: "Pull In Pay" }));
    expect(cb.onGoalUpdate.mock.calls).toEqual([
      [4, "targetAmount", "750"],
      [4, "targetDate", "2028-06-01"],
    ]);
    expect(cb.onGoalUpdateMulti).toHaveBeenCalledWith(4, {
      monthlyContribution: "750",
      allocationPercent: "18.750",
    });
    expect(cb.onLockInAllocationPercent).toHaveBeenCalledTimes(1);
    expect(cb.onRecalculateAllocation).toHaveBeenCalledTimes(1);
  });

  it("moves, deletes and adds sub-goals", async () => {
    const { unmount } = mount();
    const gutters = screen.getByText("Gutters").parentElement!;
    fireEvent.click(within(gutters).getByTitle("Move to another fund"));
    const move = screen.getByRole("combobox");
    expect(
      within(move)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Move to...", "None (top-level)", "Kitchen"]);
    fireEvent.change(move, { target: { value: "12" } });
    await act(async () => {
      fireEvent.click(within(gutters).getByTitle("Delete goal"));
    });
    fireEvent.click(screen.getByText("+ Add goal"));
    expect(cb.onUpdateParent).toHaveBeenCalledWith(8, 12);
    expect(cb.onDeleteGoal).toHaveBeenCalledWith({ id: 8 });
    expect(cb.setAddingSubGoalForFund).toHaveBeenCalledWith(4);
    expect(cb.setNewFund).toHaveBeenCalledWith({
      name: "",
      targetAmount: "",
      targetMode: "fixed",
      targetDate: "",
      parentGoalId: 4,
    });
    unmount();

    cb = fns();
    mount({ addingSubGoalForFund: 4 });
    const name = screen.getByPlaceholderText("Goal name...");
    fireEvent.change(name, { target: { value: "Chimney cap" } });
    fireEvent.change(screen.getByPlaceholderText("Target $"), {
      target: { value: "950" },
    });
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cb.setNewFund.mock.calls).toEqual([
      [{ ...newFund, name: "Chimney cap", parentGoalId: 4 }],
      [{ ...newFund, targetAmount: "950", parentGoalId: 4 }],
      [
        {
          name: "",
          targetAmount: "",
          targetMode: "fixed",
          targetDate: "",
          parentGoalId: null,
        },
      ],
    ]);
    expect(cb.onCreateFund).toHaveBeenCalledTimes(2);
    expect(cb.setAddingSubGoalForFund).toHaveBeenCalledWith(null);
  });
});
