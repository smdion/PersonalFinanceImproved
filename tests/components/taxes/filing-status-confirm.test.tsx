import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));
let admin = true;
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: admin ? "admin" : "viewer" }),
  isAdmin: () => admin,
}));
let summary: { filingStatus: string | null; filingStatusSource: string | null };
vi.mock("@/lib/hooks/use-household-income-summary", () => ({
  useHouseholdIncomeSummary: () => ({ data: summary }),
}));
import { resetTrpcMock, mutationCalls } from "../trpc-mock";
import { FilingStatusConfirm } from "@/components/taxes/filing-status-confirm";

const UPSERT = "settings.appSettings.upsert";

beforeEach(() => {
  resetTrpcMock();
  admin = true;
});

describe("FilingStatusConfirm", () => {
  it("names a W-4's status but offers no Confirm: the admin picks, and nothing is preselected", async () => {
    // The wizard stored MFJ on every job by default; one click would make
    // that stand-in the household's stored status (decision B1).
    summary = { filingStatus: "MFJ", filingStatusSource: "w4" };
    render(<FilingStatusConfirm />);
    expect(
      screen.getByText(
        /Choose your filing status: this year's taxes use Married filing jointly, taken from the W-4/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const picker = screen.getByRole("combobox", {
      name: "Filing status on this year's return",
    });
    expect(picker).toHaveValue("");
    fireEvent.change(picker, { target: { value: "Single" } });
    await waitFor(() =>
      expect(mutationCalls(UPSERT)).toEqual([
        { key: "tax_filing_status", value: "Single" },
      ]),
    );
  });

  it("asks to confirm the Retirement Profile's status, and Confirm saves that same status", async () => {
    summary = {
      filingStatus: "Single",
      filingStatusSource: "retirementProfile",
    };
    render(<FilingStatusConfirm />);
    expect(
      screen.getByText(
        /Confirm your filing status: this year's taxes use Single, taken from the Retirement Profile/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(mutationCalls(UPSERT)).toEqual([
        { key: "tax_filing_status", value: "Single" },
      ]),
    );
  });

  it("with no status known, says the projection uses Single and offers the picker, no Confirm", () => {
    summary = { filingStatus: null, filingStatusSource: null };
    render(<FilingStatusConfirm />);
    expect(
      screen.getByText(
        /none is saved, so the projection figures taxes as Single/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("is gone once the household setting holds the status", () => {
    summary = { filingStatus: "MFJ", filingStatusSource: "household" };
    const { container } = render(<FilingStatusConfirm />);
    expect(container).toBeEmptyDOMElement();
  });

  it("isn't shown to someone who can't save settings", () => {
    admin = false;
    summary = { filingStatus: "MFJ", filingStatusSource: "w4" };
    const { container } = render(<FilingStatusConfirm />);
    expect(container).toBeEmptyDOMElement();
  });
});
