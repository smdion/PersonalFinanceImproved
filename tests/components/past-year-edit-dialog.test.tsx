import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PastYearEditDialog } from "@/components/performance/past-year-edit-dialog";
import type { AccountRow } from "@/components/performance/types";

const previewMutate = vi.fn();
const saveMutate = vi.fn();
let call = 0;
const previewData = {
  success: true,
  preview: {
    accounts: [
      {
        id: 7,
        year: 2030,
        changes: [
          { field: "endingBalance", from: 1000, to: 925 },
          { field: "yearlyGainLoss", from: 200, to: 125 },
        ],
      },
      {
        id: 8,
        year: 2031,
        changes: [{ field: "beginningBalance", from: 1000, to: 925 }],
      },
    ],
    rollups: [
      {
        year: 2030,
        category: "Portfolio",
        changes: [{ field: "lifetimeGains", from: 700, to: 625 }],
      },
    ],
    chainable: { nextYear: 2031, rowId: 8 },
    checks: {
      7: [
        {
          kind: "snapshot",
          amount: -75,
          snapshotDate: "2030-12-31",
          snapshotBalance: 1000,
          accepted: false,
        },
      ],
    },
  },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    performance: {
      updateAccount: {
        // First hook in the dialog is the preview, second the save.
        useMutation: () =>
          call++ % 2 === 0
            ? {
                mutate: previewMutate,
                data: previewData,
                isPending: false,
                isError: false,
              }
            : { mutate: saveMutate, isPending: false, isError: false },
      },
    },
  },
}));

const account = {
  id: 7,
  year: 2030,
  institution: "Inst",
  accountLabel: "Brokerage",
  ownershipType: "individual",
  accountType: "brokerage",
} as AccountRow;

describe("PastYearEditDialog", () => {
  beforeEach(() => {
    call = 0;
    previewMutate.mockClear();
    saveMutate.mockClear();
  });

  it("previews with next year chained, lists what moves and what's left to check, then saves the same edit", () => {
    render(
      <PastYearEditDialog
        account={account}
        field="endingBalance"
        value="925"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(previewMutate).toHaveBeenCalledWith({
      id: 7,
      endingBalance: "925",
      chainNextYear: true,
      dryRun: true,
    });
    expect(
      screen.getByText(/2031 started at this year's old ending/),
    ).toBeTruthy();
    expect(screen.getByText(/Lifetime gains/)).toBeTruthy();
    expect(
      screen.getByText(/Ending is \$75\.00 below the 2030-12-31 snapshot/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(previewMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ chainNextYear: false, dryRun: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save change" }));
    expect(saveMutate).toHaveBeenCalledWith({
      id: 7,
      endingBalance: "925",
      chainNextYear: false,
    });
  });
});
