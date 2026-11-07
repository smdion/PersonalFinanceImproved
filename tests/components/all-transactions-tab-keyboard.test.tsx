/**
 * The upcoming-transactions table's inline edits by keyboard:
 * each editable cell's content is a button, and a cell left after an Enter
 * save still saves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
// The table unlocked, so its rows are editable.
vi.mock("@/lib/hooks/use-local-storage", () => ({
  useLocalStorage: (k: string, v: unknown) => [
    k === "ledgr:savings:txLocked" ? false : v,
    vi.fn(),
  ],
}));

import { AllTransactionsTab } from "@/components/savings/all-transactions-tab";
import type {
  GoalProjection,
  PlannedTransaction,
} from "@/components/savings/types";
import { holdMutation, mutationCalls, resetTrpcMock } from "./trpc-mock";
import { pressKey } from "./keyboard";

const UPDATE = "savings.plannedTransactions.update";

beforeEach(() => {
  resetTrpcMock();
  holdMutation(UPDATE);
});

const goal: GoalProjection = {
  goalId: 1,
  name: "Car",
  current: 0,
  target: 0,
  targetMode: "fixed",
  monthlyAllocation: 0,
  monthlyAllocations: [],
  balances: [],
  monthEvents: [],
  hasOverride: [],
};

const tires: PlannedTransaction = {
  id: 7,
  goalId: 1,
  transactionDate: "2099-01-15",
  description: "Tires",
  amount: -400,
  isRecurring: false,
  recurrenceMonths: null,
};

function mount() {
  render(
    <TooltipProvider>
      <AllTransactionsTab
        plannedTransactions={[tires]}
        goalProjections={[goal]}
        canEdit
      />
    </TooltipProvider>,
  );
}

describe("AllTransactionsTab inline edits by keyboard", () => {
  it.each([["Enter" as const], [" " as const]])(
    "%j on a cell opens its editor, as a click does",
    (key) => {
      mount();
      pressKey(screen.getByRole("button", { name: "Tires" }), key);
      expect(screen.getByDisplayValue("Tires")).toBeInstanceOf(
        HTMLInputElement,
      );
      pressKey(screen.getByRole("button", { name: "−$400.00" }), key);
      expect(screen.getByDisplayValue("400")).toBeInstanceOf(HTMLInputElement);
    },
  );

  it("after an Enter save, the next cell left by blur still saves", () => {
    mount();
    pressKey(screen.getByRole("button", { name: "Tires" }), "Enter");
    const description = screen.getByDisplayValue("Tires");
    fireEvent.change(description, { target: { value: "New tires" } });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(mutationCalls(UPDATE)).toHaveLength(1);

    pressKey(screen.getByRole("button", { name: "−$400.00" }), "Enter");
    const amount = screen.getByDisplayValue("400");
    fireEvent.change(amount, { target: { value: "450" } });
    fireEvent.blur(amount);
    expect(mutationCalls(UPDATE)).toEqual([
      expect.objectContaining({ id: 7, description: "New tires" }),
      expect.objectContaining({ id: 7, amount: "-450" }),
    ]);
  });
});
