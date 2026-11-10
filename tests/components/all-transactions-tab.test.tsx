import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The add/transfer forms are seeded with a goal once; the goal list can
// change while one is open. What's shown and what's submitted must agree.

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/hooks/use-local-storage", () => ({
  useLocalStorage: (_k: string, v: unknown) => [v, vi.fn()],
}));

import { AllTransactionsTab } from "@/components/savings/transactions/all-transactions-tab";
import type { GoalProjection } from "@/components/savings/types";
import { holdMutation, mutationCalls, resetTrpcMock } from "./trpc-mock";

const CREATE = "savings.plannedTransactions.create";

beforeEach(() => {
  resetTrpcMock();
  // No write settles: the test reads what was submitted.
  for (const path of [
    CREATE,
    "savings.plannedTransactions.update",
    "savings.plannedTransactions.delete",
    "savings.plannedTransactions.settle",
    "savings.plannedTransactions.settleMany",
    "savings.transfers.create",
    "savings.transfers.delete",
  ] as const)
    holdMutation(path);
});

const goal = (goalId: number, name: string): GoalProjection => ({
  goalId,
  name,
  current: 0,
  target: 0,
  targetMode: "fixed",
  monthlyAllocation: 0,
  monthlyAllocations: [],
  balances: [],
  monthEvents: [],
  hasOverride: [],
});

describe("AllTransactionsTab add form", () => {
  it("submits the goal it shows after the selected goal is removed", () => {
    const { rerender, container } = render(
      <AllTransactionsTab
        plannedTransactions={[]}
        goalProjections={[goal(1, "Car"), goal(2, "Travel")]}
        canEdit
      />,
    );
    fireEvent.click(screen.getByText(/Add transaction/));
    // "Car" (id 1) is selected; then it goes away.
    rerender(
      <AllTransactionsTab
        plannedTransactions={[]}
        goalProjections={[goal(2, "Travel")]}
        canEdit
      />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("2");
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Car registration"), {
      target: { value: "Tickets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mutationCalls(CREATE)).toContainEqual(
      expect.objectContaining({ goalId: 2 }),
    );
  });
});
