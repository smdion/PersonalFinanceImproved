/** Update Performance / Basis → "needs a decision". Invented data only. */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const setKind = vi.fn();
const createRule = vi.fn();
const mutation = (fn: (...a: unknown[]) => void) => ({
  useMutation: () => ({
    mutate: fn,
    isPending: false,
    isError: false,
    error: null,
  }),
});
let rows: unknown[] = [];
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ investments: { invalidate: vi.fn() } }),
    investments: {
      listDecisions: { useQuery: () => ({ data: rows }) },
      setTransactionKind: mutation(setKind),
      createRule: mutation(createRule),
    },
  },
}));

const { TransactionDecisions } =
  await import("@/components/investments/transaction-decisions");

const row = {
  id: 7,
  posted: "2026-09-14",
  amount: 2160.85,
  description: "CASH",
  institution: "Example Broker",
  accountName: "Brokerage",
  kind: "contribution",
  transferSuggestion: {
    reason: "recorded",
    other: "Example ESPP",
    otherPosted: null,
  },
};

describe("TransactionDecisions", () => {
  it("asks one question, suggesting the likely answer, and can make it a rule", () => {
    rows = [row];
    render(<TransactionDecisions year={2026} />);
    expect(
      screen.getByText(/1 transaction needs a decision/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/already record money moving in from Example ESPP/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Moved between my accounts" }),
    );
    expect(setKind).toHaveBeenCalledWith({ id: 7, kind: "transfer" });
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionContains: "Example Broker",
        descriptionContains: "CASH",
        sign: "positive",
        kind: "transfer",
        fromTransactionId: 7,
      }),
    );
  });

  it("renders nothing when there's nothing to decide", () => {
    rows = [];
    const { container } = render(<TransactionDecisions year={2026} />);
    expect(container).toBeEmptyDOMElement();
  });
});
