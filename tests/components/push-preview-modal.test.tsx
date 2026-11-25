/**
 * Regression coverage for the push-preview modal's destination wording.
 * Commit ef883ee ("Fix push-preview diff reading $0 and hardcoded YNAB
 * wording for Actual") threaded destinationLabel through the title/column
 * labels, but the body copy explaining why a push takes a while still
 * hardcoded "YNAB" verbatim — an Actual household saw YNAB-branded text
 * in the confirmation dialog.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PushPreviewModal } from "@/components/ui/push-preview-modal";

const items = [
  { name: "Emergency Fund", field: "target", currentYnab: 0, newValue: 100 },
];

describe("PushPreviewModal — destination wording", () => {
  it("uses destinationLabel in the elapsed-time body copy, not a hardcoded 'YNAB'", () => {
    render(
      <PushPreviewModal
        title="Push to Actual"
        items={items}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        direction="push"
        destinationLabel="Actual"
      />,
    );
    expect(
      screen.getByText(/Each item is a separate request to Actual/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/request to YNAB/)).not.toBeInTheDocument();
  });

  it("defaults to the generic label when no destinationLabel is given", () => {
    render(
      <PushPreviewModal
        title="Push"
        items={items}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        direction="push"
      />,
    );
    expect(
      screen.getByText(/Each item is a separate request to your budget app/),
    ).toBeInTheDocument();
  });
});

describe("PushPreviewModal — unreadable amounts", () => {
  it("names an item the push skips for a saved amount that isn't a number, never showing it as $0", () => {
    render(
      <PushPreviewModal
        title="Push to YNAB"
        items={[
          ...items,
          {
            name: "Snacks",
            field: "Goal Target",
            currentYnab: 80,
            newValue: 0,
            unreadable: true,
          },
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        direction="push"
        destinationLabel="YNAB"
      />,
    );
    expect(
      screen.getByText(
        "1 item not pushed — saved amount isn't a number: Snacks.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Snacks")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push 1 Change" })).toBeTruthy();
  });

  it("in a pull, names an item the pull skips and shows an amount it replaces as not a number, never $0", () => {
    render(
      <PushPreviewModal
        title="Pull from YNAB"
        items={[
          ...items,
          {
            name: "Odd",
            field: "Goal Target",
            currentYnab: 0,
            newValue: 50,
            unreadable: true,
          },
          {
            name: "Snacks",
            field: "Goal Target",
            currentYnab: 0,
            newValue: 0,
            currentUnreadable: true,
          },
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        direction="pull"
      />,
    );
    expect(
      screen.getByText(
        "1 item not pulled — saved amounts have no column to write into: Odd.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Odd")).not.toBeInTheDocument();
    const snacks = screen.getByText("Snacks").closest("tr")!;
    // Ledgr Now and the change: no $0 standing in for the saved value.
    const cells = [...snacks.querySelectorAll("td")].map(
      (td) => td.textContent,
    );
    expect(cells.slice(2)).toEqual(["not a number", "$0.00", "—"]);
    expect(screen.getByRole("button", { name: "Pull 2 Changes" })).toBeTruthy();
  });
});
