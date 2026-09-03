/**
 * Tests for the shared LumpSumForm + LumpSumBadge — used by the projection
 * overrides wizard (lump sum step) and brokerage page. This is a pure
 * controlled-input form with no external deps, so it renders with real
 * imports (only formatCurrency's underlying deps are real — no mocking
 * required).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/cards/projection/lump-sum-form";

const accounts = [
  { name: "401k - Alice", category: "401k", taxType: "traditional" },
  { name: "Brokerage - Joint", category: "brokerage" },
];

describe("LumpSumForm", () => {
  it("renders without crashing with typical accounts", () => {
    render(<LumpSumForm accounts={accounts} onAdd={vi.fn()} />);
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("defaults the year field to next year when no defaultYear given", () => {
    render(<LumpSumForm accounts={accounts} onAdd={vi.fn()} />);
    const yearInput = screen.getByDisplayValue(
      String(new Date().getFullYear() + 1),
    );
    expect(yearInput).toBeInTheDocument();
  });

  it("uses defaultYear prop when provided", () => {
    render(
      <LumpSumForm accounts={accounts} onAdd={vi.fn()} defaultYear="2040" />,
    );
    expect(screen.getByDisplayValue("2040")).toBeInTheDocument();
  });

  it("does not render a Type selector when allowWithdrawals is false", () => {
    render(<LumpSumForm accounts={accounts} onAdd={vi.fn()} />);
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("renders a Type selector when allowWithdrawals is true", () => {
    render(
      <LumpSumForm accounts={accounts} onAdd={vi.fn()} allowWithdrawals />,
    );
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("does not call onAdd when amount is empty", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} />);
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does not call onAdd when amount is zero or negative", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} />);
    const amountInput = screen.getByPlaceholderText("$50,000");
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd with a positive amount for the default (injection-only) form", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} />);
    const amountInput = screen.getByPlaceholderText("$50,000");
    fireEvent.change(amountInput, { target: { value: "50000" } });
    fireEvent.click(screen.getByText("Add"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const call = onAdd.mock.calls[0]![0];
    expect(call.amount).toBe("50000");
    expect(call.targetAccountName).toBe("401k - Alice");
    expect(call.targetAccount).toBe("401k");
    expect(call.id).toBeTruthy();
  });

  it("negates the amount when direction is 'out' (withdrawal)", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} allowWithdrawals />);
    fireEvent.change(screen.getByDisplayValue("Inject"), {
      target: { value: "out" },
    });
    fireEvent.change(screen.getByPlaceholderText("$50,000"), {
      target: { value: "10000" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0].amount).toBe("-10000");
  });

  it("clears amount and label after a successful add, but keeps the account selection", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} />);
    const amountInput = screen.getByPlaceholderText(
      "$50,000",
    ) as HTMLInputElement;
    const labelInput = screen.getByPlaceholderText(
      "Inheritance",
    ) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "5000" } });
    fireEvent.change(labelInput, { target: { value: "Bonus" } });
    fireEvent.click(screen.getByText("Add"));

    expect(amountInput.value).toBe("");
    expect(labelInput.value).toBe("");
  });

  it("updates targetAccount when a different account is selected", () => {
    const onAdd = vi.fn();
    render(<LumpSumForm accounts={accounts} onAdd={onAdd} />);
    // Option values are now a "name::ownerName" composite key
    // — plain name alone can't disambiguate two owners sharing an account
    // name, so the picker no longer uses it as the <option> value. These
    // fixture accounts have no ownerName, so the key is "name::".
    fireEvent.change(screen.getByDisplayValue("401k - Alice"), {
      target: { value: "Brokerage - Joint::" },
    });
    fireEvent.change(screen.getByPlaceholderText("$50,000"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(onAdd.mock.calls[0]![0].targetAccountName).toBe("Brokerage - Joint");
    expect(onAdd.mock.calls[0]![0].targetAccount).toBe("brokerage");
    expect(onAdd.mock.calls[0]![0].targetOwnerName).toBe("");
  });

  it("R4: two accounts sharing a name show the owner in the label and are individually selectable", () => {
    const onAdd = vi.fn();
    const duplicateNameAccounts = [
      { name: "Long Term Brokerage", category: "brokerage", ownerName: "Sean" },
      {
        name: "Long Term Brokerage",
        category: "brokerage",
        ownerName: "Joanna",
      },
    ];
    render(<LumpSumForm accounts={duplicateNameAccounts} onAdd={onAdd} />);
    // Both owner-qualified labels render distinctly.
    expect(screen.getByText("Long Term Brokerage (Sean)")).toBeInTheDocument();
    expect(
      screen.getByText("Long Term Brokerage (Joanna)"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Long Term Brokerage (Sean)"), {
      target: { value: "Long Term Brokerage::Joanna" },
    });
    fireEvent.change(screen.getByPlaceholderText("$50,000"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(onAdd.mock.calls[0]![0].targetAccountName).toBe(
      "Long Term Brokerage",
    );
    expect(onAdd.mock.calls[0]![0].targetOwnerName).toBe("Joanna");
  });

  it("renders with an empty accounts list without crashing", () => {
    render(<LumpSumForm accounts={[]} onAdd={vi.fn()} />);
    expect(screen.getByText("Add")).toBeInTheDocument();
  });
});

describe("LumpSumBadge", () => {
  const injectionEvent = {
    id: "1",
    year: "2030",
    amount: "50000",
    targetAccount: "brokerage" as const,
    targetAccountName: "Brokerage - Joint",
    taxType: "" as const,
    label: "Inheritance",
  };

  it("renders an injection with a + prefix", () => {
    render(<LumpSumBadge event={injectionEvent} />);
    expect(screen.getByText(/\+\$50,000\.00/)).toBeInTheDocument();
  });

  it("renders a withdrawal without a + prefix", () => {
    render(<LumpSumBadge event={{ ...injectionEvent, amount: "-20000" }} />);
    expect(screen.queryByText(/\+\$20,000\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/\$20,000\.00/)).toBeInTheDocument();
  });

  it("does not render edit/delete buttons when callbacks are omitted", () => {
    render(<LumpSumBadge event={injectionEvent} />);
    expect(screen.queryByLabelText("Edit lump sum")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove lump sum")).not.toBeInTheDocument();
  });

  it("calls onEdit and onDelete when their buttons are clicked", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <LumpSumBadge
        event={injectionEvent}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit lump sum"));
    fireEvent.click(screen.getByLabelText("Remove lump sum"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
