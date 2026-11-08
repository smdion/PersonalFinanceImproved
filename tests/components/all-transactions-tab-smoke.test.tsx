/**
 * Smoke test before the split of the savings page's All Transactions tab
 * (RULES § Refactoring: mount with mocked tRPC, assert key elements, one
 * mutation-plumbing test per write). It pins every cell the table renders
 * for an invented household's history, upcoming, transfer and extra-paycheck
 * rows, with the formatters the tab uses, and each write's input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatCurrency, formatDate } from "@/lib/utils/format";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
// All history, extra-paycheck rows shown, the table unlocked.
const stored = vi.hoisted(() => ({
  "ledgr:savings:txHistoryWindow": "all",
  "ledgr:savings:txLocked": false,
  "ledgr:savings:showRuleTx": true,
}));
vi.mock("@/lib/hooks/use-local-storage", () => ({
  useLocalStorage: (k: string, v: unknown) => [
    k in stored ? stored[k as keyof typeof stored] : v,
    vi.fn(),
  ],
}));

import { AllTransactionsTab } from "@/components/savings/transactions/tab";
import type {
  GoalProjection,
  PlannedTransaction,
} from "@/components/savings/types";
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setQuery,
} from "./trpc-mock";

const PATHS = [
  "savings.plannedTransactions.create",
  "savings.plannedTransactions.update",
  "savings.plannedTransactions.delete",
  "savings.plannedTransactions.settle",
  "savings.plannedTransactions.settleMany",
  "savings.transfers.create",
  "savings.transfers.delete",
] as const;

beforeEach(() => {
  resetTrpcMock();
  for (const path of PATHS) holdMutation(path);
});

/** `YYYY-MM-15`, `monthsAhead` calendar months from this one. */
function midMonth(monthsAhead: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 15);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-15`;
}
const shortDate = (iso: string) =>
  formatDate(new Date(iso + "T00:00:00"), "short");

const goal = (
  goalId: number,
  name: string,
  balances: number[],
): GoalProjection => ({
  goalId,
  name,
  current: 0,
  target: 0,
  targetMode: "fixed",
  monthlyAllocation: 0,
  monthlyAllocations: [],
  balances,
  monthEvents: [],
  hasOverride: [],
});
const goals = [
  goal(1, "Car", [1000, 1250.5, 1500, -75]),
  goal(2, "Travel", [300, 400, 500, 600]),
];

const tx = (
  t: Partial<PlannedTransaction> & Pick<PlannedTransaction, "id">,
): PlannedTransaction => ({
  goalId: 1,
  transactionDate: midMonth(1),
  description: "",
  amount: 0,
  isRecurring: false,
  recurrenceMonths: null,
  ...t,
});

const oldOpen = midMonth(-5);
const oldSettled = midMonth(-6);
const planned: PlannedTransaction[] = [
  // History: one still open five months on, one settled, one transfer.
  tx({
    id: 1,
    transactionDate: oldOpen,
    description: "Oil change",
    amount: -80,
  }),
  tx({
    id: 2,
    transactionDate: oldSettled,
    description: "Registration",
    amount: -120.25,
    settledOccurrences: [oldSettled.slice(0, 7)],
  }),
  tx({
    id: 3,
    goalId: 1,
    transactionDate: midMonth(-4),
    description: "Rebalance",
    amount: -200,
    transferPairId: "p-old",
  }),
  tx({
    id: 4,
    goalId: 2,
    transactionDate: midMonth(-4),
    description: "Rebalance",
    amount: 200,
    transferPairId: "p-old",
  }),
  // Upcoming: a withdrawal, a deposit past the balances, a recurring one,
  // a transfer and an extra-paycheck row.
  tx({
    id: 10,
    transactionDate: midMonth(1),
    description: "Tires",
    amount: -400,
  }),
  tx({
    id: 11,
    goalId: 2,
    transactionDate: midMonth(12),
    description: "Refund",
    amount: 55.5,
  }),
  tx({
    id: 12,
    transactionDate: midMonth(3),
    description: "Insurance",
    amount: -90,
    isRecurring: true,
    recurrenceMonths: 3,
  }),
  tx({
    id: 13,
    goalId: 2,
    transactionDate: midMonth(2),
    description: "Move to car",
    amount: 150,
    transferPairId: "p-new",
  }),
  tx({
    id: 14,
    goalId: 1,
    transactionDate: midMonth(2),
    description: "Move to car",
    amount: -150,
    transferPairId: "p-new",
  }),
  tx({
    id: 15,
    goalId: 2,
    transactionDate: midMonth(2),
    description: "Extra paycheck",
    amount: 700,
    source: "rule",
  }),
];

function mount(canEdit = true) {
  return render(
    <TooltipProvider>
      <AllTransactionsTab
        plannedTransactions={planned}
        goalProjections={goals}
        canEdit={canEdit}
      />
    </TooltipProvider>,
  );
}

/** Each row's cells' text, joined by " | " (the separator row is aria-hidden). */
const rowTexts = () =>
  screen.getAllByRole("row").map((r) =>
    Array.from(r.children)
      .map((c) => c.textContent ?? "")
      .join(" | "),
  );

describe("AllTransactionsTab smoke", () => {
  it("renders every history and upcoming row with today's formatters", () => {
    mount();
    const m = formatCurrency;
    expect(rowTexts()).toEqual([
      "Fund | Date | Description | Amount | After | Recurring | Settled?",
      // History, newest first.
      `Car→Travel | ${shortDate(midMonth(-4))} | transferRebalance | ${m(200)} | — | — | `,
      `Car | ${shortDate(oldOpen)} | Oil change | −${m(80)} | — | — | 5mo ago — still open?Settle`,
      `Car | ${shortDate(oldSettled)} | Registration | −${m(120.25)} | — | — | `,
      `Car | ${shortDate(midMonth(1))} | Tires | −${m(400)} | ${m(1250.5)} | — | Settle×`,
      `Car→Travel | ${shortDate(midMonth(2))} | transferMove to car | ${m(150)} | — | — | Settle×`,
      `Travel | ${shortDate(midMonth(2))} | extra paycheckExtra paycheck | +${m(700)} | ${m(500)} | — | Settle`,
      `Car | ${shortDate(midMonth(3))} | Insurance | −${m(90)} | ${m(-75)} | every 3mo | ×`,
      `Travel | ${shortDate(midMonth(12))} | Refund | +${m(55.5)} | — | — | Settle×`,
    ]);
    expect(screen.getByText("─── Upcoming ───")).toBeInTheDocument();
  });

  it("without edit rights: no Settled column, no add, no row actions", () => {
    mount(false);
    const texts = rowTexts();
    expect(texts[0]).toBe(
      "Fund | Date | Description | Amount | After | Recurring",
    );
    expect(texts.join("\n")).not.toMatch(/Settle|×/);
    expect(screen.queryByText(/Add transaction/)).toBeNull();
  });

  it("an inline amount edit saves once, keeping the row's sign", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: `−${formatCurrency(400)}` }),
    );
    const amount = screen.getByDisplayValue("400");
    fireEvent.change(amount, { target: { value: "425" } });
    fireEvent.keyDown(amount, { key: "Enter" });
    fireEvent.blur(amount);
    expect(mutationCalls("savings.plannedTransactions.update")).toEqual([
      {
        id: 10,
        goalId: 1,
        transactionDate: midMonth(1),
        description: "Tires",
        amount: "-425",
        isRecurring: false,
        recurrenceMonths: null,
      },
    ]);
  });

  it("settles an open row, and deletes a row or a transfer pair", () => {
    mount();
    const tires = screen.getByText("Tires").closest("tr")!;
    fireEvent.click(within(tires).getByRole("button", { name: "Settle" }));
    fireEvent.click(within(tires).getByRole("button", { name: "×" }));
    const move = screen.getByText("Move to car").closest("tr")!;
    fireEvent.click(within(move).getByRole("button", { name: "×" }));
    expect(mutationCalls("savings.plannedTransactions.settle")).toEqual([
      { plannedTxId: 10, occurrenceMonth: midMonth(1).slice(0, 7) },
    ]);
    expect(mutationCalls("savings.plannedTransactions.delete")).toEqual([
      { id: 10 },
    ]);
    expect(mutationCalls("savings.transfers.delete")).toEqual([
      { transferPairId: "p-new" },
    ]);
  });

  it("adds a transaction and a transfer from the add form", () => {
    const { container } = mount();
    fireEvent.click(screen.getByText(/Add transaction/));
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2027-02-01" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "−" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Car registration"), {
      target: { value: "Rebate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("radio", { name: "Transfer" }));
    const [from, to] = within(
      container.querySelector(".space-y-3 > div")!,
    ).getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(from!, { target: { value: "2" } });
    fireEvent.change(to!, { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "75" },
    });
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2027-03-01" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Move travel funds to home projects"),
      { target: { value: "Top up" } },
    );
    expect(document.body).toHaveTextContent(
      `${formatCurrency(75)} from Travel → Car`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Transfer" }));

    expect(mutationCalls("savings.plannedTransactions.create")).toEqual([
      {
        goalId: 1,
        transactionDate: "2027-02-01",
        description: "Rebate",
        amount: "60",
        isRecurring: false,
        recurrenceMonths: null,
      },
    ]);
    expect(mutationCalls("savings.transfers.create")).toEqual([
      {
        fromGoalId: 2,
        toGoalId: 1,
        transactionDate: "2027-03-01",
        amount: 75,
        description: "Top up",
        isRecurring: false,
        recurrenceMonths: null,
      },
    ]);
  });

  it("offers settlement suggestions, settles them all, and dismisses one", () => {
    setQuery("savings.plannedTransactions.getSettlementSuggestions", {
      suggestions: [
        { plannedTxId: 1, occurrenceMonth: oldOpen.slice(0, 7) },
        { plannedTxId: 10, occurrenceMonth: midMonth(1).slice(0, 7) },
      ],
    });
    mount();
    expect(document.body).toHaveTextContent(
      "2 planned transactions look settled — real activity was found",
    );
    expect(document.body).toHaveTextContent(
      `Car — Oil change (${oldOpen.slice(0, 7)})`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Settle all" }));
    expect(mutationCalls("savings.plannedTransactions.settleMany")).toEqual([
      {
        occurrences: [
          { plannedTxId: 1, occurrenceMonth: oldOpen.slice(0, 7) },
          { plannedTxId: 10, occurrenceMonth: midMonth(1).slice(0, 7) },
        ],
      },
    ]);
    const oil = screen.getByText(/Car — Oil change/).closest("li")!;
    fireEvent.click(within(oil).getByRole("button", { name: "Dismiss" }));
    // Today's wording for one ("look s"; a v0.11 wording bug, pinned as is).
    expect(document.body).toHaveTextContent(
      "1 planned transaction look s settled",
    );
    expect(screen.queryByText(/Car — Oil change/)).toBeNull();
  });
});
