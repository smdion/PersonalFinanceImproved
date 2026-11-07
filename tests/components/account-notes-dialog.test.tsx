/**
 * Smoke test for a Performance account-year's notes dialog (v0.10.4 commit
 * 5b, before 7 moves it onto Modal): the open check, the estimate toggles
 * and the note render, and accepting a gap and saving the note each send
 * performance.annotateAccount.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mutationCalls, resetTrpcMock } from "./trpc-mock";
import { AccountNotesDialog } from "@/components/performance/account-notes-dialog";
import type { AccountRow } from "@/components/performance/types";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const account: AccountRow = {
  id: 41,
  institution: "Example Brokerage",
  accountLabel: "Joint Brokerage (Example Brokerage)",
  ownerName: null,
  ownerPersonId: null,
  ownershipType: "joint",
  beginningBalance: 100000,
  totalContributions: 6000,
  yearlyGainLoss: 8000,
  endingBalance: 114012.34,
  annualReturnPct: 0.077,
  employerContributions: 0,
  fees: 0,
  distributions: 0,
  rollovers: 0,
  parentCategory: "Portfolio",
  accountType: "brokerage",
  subType: null,
  isActive: true,
  performanceAccountId: 9,
  displayOrder: 1,
  year: 2025,
  contributionBasis: null,
  conversionBasis: null,
  latestConversionYear: null,
  checks: [{ kind: "unbalanced", amount: 12.34, accepted: false }],
  note: "From the December statement",
  estimatedFields: ["fees"],
  acceptedChecks: {},
};

describe("AccountNotesDialog", () => {
  beforeEach(() => resetTrpcMock());

  it("shows the account-year, its open check, estimates and note", () => {
    render(
      <AccountNotesDialog
        account={account}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      /2025: notes and checks$/,
    );
    expect(screen.getByText("Doesn't add up by $12.34")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Fees & taxes withheld" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Note")).toHaveValue(
      "From the December statement",
    );
  });

  it("accepts a gap with its reason", () => {
    render(
      <AccountNotesDialog
        account={account}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Reason to accept: Doesn't add up by $12.34"),
      { target: { value: "Provider's reported gain" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutationCalls("performance.annotateAccount")).toEqual([
      {
        id: 41,
        accept: { kind: "unbalanced", note: "Provider's reported gain" },
      },
    ]);
  });

  it("saves the note and the still-estimated figures, then closes", () => {
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(
      <AccountNotesDialog
        account={account}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fees & taxes withheld" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ending" }));
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Checked against the statement" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save note & estimates" }),
    );
    expect(mutationCalls("performance.annotateAccount")).toEqual([
      {
        id: 41,
        note: "Checked against the statement",
        estimatedFields: ["endingBalance"],
      },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
