/**
 * Other pay & taxable benefits section: lines show with how they're taxed;
 * a preset change updates the line's flags; adding a line uses the preset's
 * flags. Invented lines only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  holdMutation,
  mutationCallOptions,
  mutationCalls,
  resetTrpcMock,
} from "./trpc-mock";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { OtherPaySection } from "@/components/paycheck/other-pay-section";

const row = {
  id: 3,
  jobId: 1,
  earningName: "Basic Life/AD&D",
  isCash: false,
  federalTaxable: true,
  ficaTaxable: true,
  amount: 7.81,
};

beforeEach(() => {
  resetTrpcMock();
  // The writes don't settle: the tests read what was sent.
  holdMutation("paycheck.earnings.create");
  holdMutation("paycheck.earnings.update");
  holdMutation("paycheck.earnings.delete");
});

describe("OtherPaySection", () => {
  it("shows a taxable benefit and changes its treatment in one update", () => {
    render(<OtherPaySection jobId={1} rows={[row]} onSetAmount={vi.fn()} />);
    const picker = screen.getByLabelText(
      "How Basic Life/AD&D is paid and taxed",
    );
    expect(picker).toHaveValue("imputed");
    fireEvent.change(picker, { target: { value: "paidTaxed" } });
    expect(mutationCalls("paycheck.earnings.update")).toContainEqual(
      expect.objectContaining({
        id: 3,
        isCash: true,
        federalTaxable: true,
        ficaTaxable: true,
      }),
    );
  });

  it("adds a line with the chosen preset's flags", () => {
    render(<OtherPaySection jobId={1} rows={[]} onSetAmount={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add other pay or a taxable benefit",
      }),
    );
    fireEvent.change(screen.getByPlaceholderText(/Name as on your stub/), {
      target: { value: "Group life" },
    });
    fireEvent.change(screen.getByLabelText("How your pay stub lists it"), {
      target: { value: "imputed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mutationCalls("paycheck.earnings.create")).toEqual([
      {
        jobId: 1,
        earningName: "Group life",
        isCash: false,
        federalTaxable: true,
        ficaTaxable: true,
      },
    ]);
    expect(mutationCallOptions("paycheck.earnings.create")).toEqual([
      expect.anything(),
    ]);
  });

  it("read-only with no lines renders nothing", () => {
    const { container } = render(
      <OtherPaySection jobId={1} rows={[]} onSetAmount={vi.fn()} readOnly />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
