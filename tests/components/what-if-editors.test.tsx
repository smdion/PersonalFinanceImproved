/**
 * The What-If tab's deductions and contribution-accounts editors: collapse
 * and expand with a count, one block per person with its "+ Add" link,
 * "None" when a person has nothing, live rows pin-editable, and hand-added
 * rows that only an admin can "make real". Invented household only.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  WhatIfContributionsEditor,
  WhatIfDeductionsEditor,
  type ContribAddition,
  type DeductionAddition,
} from "@/app/(dashboard)/budget/what-if-editors";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";

function view(
  id: number,
  name: string,
  rows: {
    rawDeductions?: unknown[];
    rawContribs?: unknown[];
  } = {},
): PaycheckPersonView {
  return {
    person: { id, name },
    job: { id: id * 10 },
    rawDeductions: rows.rawDeductions ?? [],
    rawContribs: rows.rawContribs ?? [],
    // eslint-disable-next-line no-restricted-syntax -- a partial view: the editors read only person, job and the raw rows
  } as unknown as PaycheckPersonView;
}

const ALEX = view(1, "Alex", {
  rawDeductions: [
    {
      id: 101,
      deductionName: "Dental",
      amountPerPeriod: "12.50",
      isPretax: true,
      ficaExempt: true,
    },
  ],
  rawContribs: [
    {
      id: 201,
      accountType: "401k",
      contributionMethod: "percent_of_salary",
      contributionValue: "6",
      ownership: "individual",
      taxTreatment: "pre_tax",
    },
  ],
});
const SAM = view(2, "Sam");

const deductionAddition: DeductionAddition = {
  localId: -1,
  personId: 1,
  name: "Vision",
  amountPerPeriod: 5,
  isPretax: true,
  ficaExempt: true,
};
const contribAddition: ContribAddition = {
  localId: -2,
  personId: 1,
  accountType: "ira",
  contributionMethod: "fixed_annual",
  contributionValue: "3000",
};

function deductionsEditor(
  over: Partial<Parameters<typeof WhatIfDeductionsEditor>[0]> = {},
) {
  const props = {
    views: [ALEX, SAM],
    deductionEdits: new Map<number, number>(),
    onEditDeduction: vi.fn(),
    onResetDeduction: vi.fn(),
    additions: [deductionAddition],
    onAddDeduction: vi.fn(),
    onUpdateAddition: vi.fn(),
    onRemoveAddition: vi.fn(),
    canManagePaycheck: true,
    onMakeReal: vi.fn(),
    makeRealPendingId: null,
    ...over,
  };
  render(<WhatIfDeductionsEditor {...props} />);
  return props;
}

function contributionsEditor(
  over: Partial<Parameters<typeof WhatIfContributionsEditor>[0]> = {},
) {
  const props = {
    views: [ALEX, SAM],
    activeFields: new Map<number, string>(),
    onEdit: vi.fn(),
    onReset: vi.fn(),
    additions: [contribAddition],
    onAddAccount: vi.fn(),
    onUpdateAddition: vi.fn(),
    onRemoveAddition: vi.fn(),
    canManagePaycheck: true,
    onMakeReal: vi.fn(),
    makeRealPendingId: null,
    ...over,
  };
  render(<WhatIfContributionsEditor {...props} />);
  return props;
}

describe("What-If deductions editor", () => {
  it("collapses to a count and opens again", () => {
    deductionsEditor();
    fireEvent.click(screen.getByText("▾ Deductions"));
    fireEvent.click(screen.getByText("Edit deductions (1 total) ▸"));
    expect(screen.getByText("▾ Deductions")).toBeTruthy();
  });

  it("one block per person: add, None when empty", () => {
    const p = deductionsEditor();
    expect(screen.getByText("Alex’s deductions")).toBeTruthy();
    expect(screen.getByText("Sam’s deductions")).toBeTruthy();
    expect(screen.getByText("Dental")).toBeTruthy();
    expect(screen.getAllByText("None")).toHaveLength(1);
    fireEvent.click(screen.getAllByText("+ Add deduction")[1]!);
    expect(p.onAddDeduction).toHaveBeenCalledWith(2);
  });

  it("a live row pins on edit", () => {
    const p = deductionsEditor();
    fireEvent.change(screen.getByDisplayValue("12.5"), {
      target: { value: "20" },
    });
    expect(p.onEditDeduction).toHaveBeenCalledWith(101, 20);
  });

  it("an added row: make it real with the person's job, or remove it", () => {
    const p = deductionsEditor();
    fireEvent.click(screen.getByText("Make real"));
    expect(p.onMakeReal).toHaveBeenCalledWith(deductionAddition, 10);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(p.onRemoveAddition).toHaveBeenCalledWith(-1);
  });

  it("make real: admins only, and shows it's saving", () => {
    deductionsEditor({ canManagePaycheck: false });
    expect(screen.queryByText("Make real")).toBeNull();
    document.body.innerHTML = "";
    deductionsEditor({ makeRealPendingId: -1 });
    expect((screen.getByText("Saving…") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("nobody: renders nothing", () => {
    const { container } = render(
      <WhatIfDeductionsEditor
        views={[]}
        deductionEdits={new Map()}
        onEditDeduction={vi.fn()}
        onResetDeduction={vi.fn()}
        additions={[]}
        onAddDeduction={vi.fn()}
        onUpdateAddition={vi.fn()}
        onRemoveAddition={vi.fn()}
        canManagePaycheck
        onMakeReal={vi.fn()}
        makeRealPendingId={null}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("What-If contribution accounts editor", () => {
  it("collapses to a count and opens again", () => {
    contributionsEditor();
    fireEvent.click(screen.getByText("▾ Contribution accounts"));
    fireEvent.click(screen.getByText("Edit contribution accounts (1 total) ▸"));
    expect(screen.getByText("▾ Contribution accounts")).toBeTruthy();
  });

  it("one block per person: add, None when empty", () => {
    const p = contributionsEditor();
    expect(screen.getByText("Alex’s accounts")).toBeTruthy();
    expect(screen.getByText("Sam’s accounts")).toBeTruthy();
    expect(screen.getAllByText("None")).toHaveLength(1);
    fireEvent.click(screen.getAllByText("+ Add account")[1]!);
    expect(p.onAddAccount).toHaveBeenCalledWith(2);
  });

  it("a live row pins on edit, as a string value", () => {
    const p = contributionsEditor();
    fireEvent.change(screen.getByDisplayValue("6"), {
      target: { value: "8" },
    });
    expect(p.onEdit).toHaveBeenCalledWith(201, "8");
  });

  it("an added row: make it real, or remove it", () => {
    const p = contributionsEditor();
    const row = screen.getByDisplayValue("3000").closest("tr")!;
    fireEvent.click(within(row).getByText("Make real"));
    expect(p.onMakeReal).toHaveBeenCalledWith(contribAddition);
    fireEvent.click(within(row).getByTitle("Remove"));
    expect(p.onRemoveAddition).toHaveBeenCalledWith(-2);
  });

  it("make real: admins only", () => {
    contributionsEditor({ canManagePaycheck: false });
    expect(screen.queryByText("Make real")).toBeNull();
  });
});
