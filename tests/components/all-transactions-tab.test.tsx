import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The add/transfer forms are seeded with a goal once; the goal list can
// change while one is open. What's shown and what's submitted must agree.

const { createTx, mutation } = vi.hoisted(() => {
  const createTx = vi.fn();
  const mutation = (fn?: (input: unknown) => void) => ({
    useMutation: () => ({ mutate: fn ?? vi.fn(), isPending: false }),
  });
  return { createTx, mutation };
});
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ savings: { invalidate: vi.fn() } }),
    savings: {
      plannedTransactions: {
        create: mutation((i) => createTx(i)),
        update: mutation(),
        delete: mutation(),
        settle: mutation(),
        settleMany: mutation(),
        getSettlementSuggestions: { useQuery: () => ({ data: undefined }) },
      },
      transfers: { create: mutation(), delete: mutation() },
    },
  },
}));
vi.mock("@/lib/hooks/use-local-storage", () => ({
  useLocalStorage: (_k: string, v: unknown) => [v, vi.fn()],
}));

import { AllTransactionsTab } from "@/components/savings/all-transactions-tab";
import type { GoalProjection } from "@/components/savings/types";

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
    expect(createTx).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 2 }),
    );
  });
});
