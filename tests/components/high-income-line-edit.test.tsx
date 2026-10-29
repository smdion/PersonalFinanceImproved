// @vitest-environment jsdom
/**
 * The high-income line: the saved setting wins; without one, the default by
 * filing status, labelled with what it follows; cleared, back to the
 * default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let saved: number | null = null;
const setSaved = vi.fn();
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: () => [saved, setSaved],
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin" }),
  isAdmin: () => true,
}));
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    contribution: {
      highIncomeLine: {
        useQuery: () => ({ data: { threshold: 100_000, basis: "Single" } }),
      },
    },
  },
}));

import { HighIncomeLineEdit } from "@/components/cards/dashboard/high-income-line-edit";

describe("HighIncomeLineEdit", () => {
  beforeEach(() => {
    saved = null;
    setSaved.mockClear();
  });

  it("shows the default with the filing status it follows", () => {
    render(<HighIncomeLineEdit />);
    expect(screen.getByText("$100,000 (Single)")).toBeInTheDocument();
  });

  it("a saved line wins, without a basis", () => {
    saved = 150_000;
    render(<HighIncomeLineEdit />);
    expect(screen.getByText("$150,000")).toBeInTheDocument();
  });

  it("clearing it goes back to the default", () => {
    saved = 150_000;
    render(<HighIncomeLineEdit />);
    fireEvent.click(screen.getByText("$150,000"));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(setSaved).toHaveBeenCalledWith(null);
  });
});
