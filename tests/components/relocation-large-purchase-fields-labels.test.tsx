/**
 * The relocation add-purchase form's labels reach their fields.
 */
import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  PurchaseBasicsFields,
  PurchaseCostFields,
  type PurchaseFormState,
} from "@/components/tools/relocation/large-purchase-fields";
import { expectLabelReachesControl } from "./label-click";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const form: PurchaseFormState = {
  name: "",
  purchasePrice: "",
  purchaseYear: "2030",
  financed: true,
  downPaymentPercent: "20",
  loanRate: "6",
  loanTermYears: "30",
  ongoingMonthlyCost: "",
  saleProceeds: "",
};

describe("add-purchase form labels", () => {
  it("clicking each label reaches its field", () => {
    render(
      <>
        <PurchaseBasicsFields purchaseForm={form} setPurchaseForm={vi.fn()} />
        <PurchaseCostFields purchaseForm={form} setPurchaseForm={vi.fn()} />
      </>,
    );
    for (const name of [
      "Name",
      "Purchase Price ($)",
      "Purchase Year",
      "Down Payment %",
      "Loan Rate %",
      "Loan Term (years)",
      "Ongoing Monthly Cost ($)",
      "Sale Proceeds ($)",
    ])
      expectLabelReachesControl(name);
  });
});
