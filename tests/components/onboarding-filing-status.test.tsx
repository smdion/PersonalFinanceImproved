/**
 * The first-run wizard asks how the household files: the answer is saved as
 * the household's return status (so no W-4 stands in for it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";
import { FilingStatusQuestion } from "@/components/onboarding/filing-status-question";

const UPSERT = "settings.appSettings.upsert";

beforeEach(() => {
  resetTrpcMock();
  setQuery("settings.appSettings.list", []);
});

describe("the wizard's filing status question", () => {
  it("offers every return status, none chosen", () => {
    render(<FilingStatusQuestion />);
    const select = screen.getByRole("combobox", {
      name: "Filing status on your tax return",
    });
    expect(select).toHaveValue("");
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual([
      "Choose…",
      "Married filing jointly",
      "Single",
      "Head of household",
    ]);
  });

  it("saves the answer as the household's return status", async () => {
    render(<FilingStatusQuestion />);
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Filing status on your tax return",
      }),
      { target: { value: "Single" } },
    );
    await waitFor(() =>
      expect(mutationCalls(UPSERT)).toEqual([
        { key: "tax_filing_status", value: "Single" },
      ]),
    );
  });
});
