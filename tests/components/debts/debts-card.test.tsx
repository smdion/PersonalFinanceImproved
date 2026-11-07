/**
 * Smoke test for the Liabilities page's other-debts card (v0.10.4 commit
 * 5b), mounted on the ws-h2 baseline household, the one with a debt, its
 * queries answered by the router (tests/baseline/screen-mount.tsx): the
 * debt's row renders, a new debt sends debts.create, and a debt's name
 * cell, a button for an admin, opens it for editing.
 */
import "../../routers/setup-mocks";
import "../../baseline/mocks";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { seededPage } from "../../baseline/screen-mount";
import { mutationCalls } from "../trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../../baseline/screen-mount")).screenTrpc(
    (await import("../trpc-mock")).trpc,
  ),
}));

const page = seededPage(
  "ws-h2",
  async () => (await import("@/components/debts/debts-card")).DebtsCard,
);

describe("DebtsCard", () => {
  it("shows the household's debt", async () => {
    await page.mount();
    expect(screen.getByText("Other debts")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("$14,000.00")).toBeTruthy();
    expect(within(table).getByText("6.90%")).toBeTruthy();
  });

  it("adds a debt", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Example Student Loans" },
    });
    fireEvent.change(screen.getByLabelText("Balance"), {
      target: { value: "18500" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 6.5"), {
      target: { value: "5.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutationCalls("debts.create")).toEqual([
      {
        name: "Example Student Loans",
        kind: "student_loan",
        ownerPersonId: null,
        balance: "18500",
        balanceAsOf: "2026-03-07",
        interestRate: "0.055",
        monthlyPayment: null,
        originalAmount: null,
        purchasePrice: null,
        termMonths: null,
        openedDate: null,
        paidOffDate: null,
        notes: null,
      },
    ]);
  });

  it("opens a debt for editing from its name cell, and saves it once", async () => {
    await page.mount();
    fireEvent.click(screen.getByRole("button", { name: /^Car loan/ }));
    expect(screen.getByLabelText("Name")).toHaveValue("Car loan");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutationCalls("debts.update")).toHaveLength(1);
    expect(mutationCalls("debts.update")[0]).toMatchObject({
      id: expect.any(Number),
      name: "Car loan",
      balance: "14000",
    });
  });
});
