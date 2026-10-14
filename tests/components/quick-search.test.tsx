/**
 * Quick search (Cmd/Ctrl-K) from the keyboard: opens, filters, moves,
 * opens the page, and closes — announced as a combobox over a listbox.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickSearch } from "@/components/layout/quick-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const openWithKeyboard = () =>
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });

describe("QuickSearch", () => {
  it("opens on Ctrl-K, filters, and Enter opens the highlighted page", () => {
    render(<QuickSearch />);
    expect(screen.queryByRole("dialog")).toBeNull();
    openWithKeyboard();
    const box = screen.getByRole("combobox", { name: "Search pages" });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "milestones" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Milestones");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/milestones");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("arrow keys move the highlight; Escape closes", () => {
    render(<QuickSearch />);
    openWithKeyboard();
    const box = screen.getByRole("combobox", { name: "Search pages" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
