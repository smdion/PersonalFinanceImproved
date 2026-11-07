import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/ui/sortable-header";
import { pressKey } from "./keyboard";

function Table({ sort, onSort }: { sort: SortDirection; onSort: () => void }) {
  return (
    <table>
      <thead>
        <tr>
          <SortableHeader className="px-4" sort={sort} onSort={onSort}>
            Total
          </SortableHeader>
        </tr>
      </thead>
    </table>
  );
}

describe("SortableHeader", () => {
  it.each([
    ["none" as const, "Total ↕"],
    ["ascending" as const, "Total ↑"],
    ["descending" as const, "Total ↓"],
  ])("a %s column says so in aria-sort and shows %j", (sort, text) => {
    render(<Table sort={sort} onSort={() => {}} />);
    const header = screen.getByRole("columnheader");
    expect(header).toHaveAttribute("aria-sort", sort);
    expect(header).toHaveClass("px-4");
    expect(header).toHaveTextContent(text);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j sorts once, as a click does",
    (key) => {
      const onSort = vi.fn();
      render(<Table sort="none" onSort={onSort} />);
      pressKey(screen.getByRole("button"), key);
      expect(onSort).toHaveBeenCalledTimes(1);
    },
  );

  it("a click on the label or the cell sorts once", () => {
    const onSort = vi.fn();
    render(<Table sort="none" onSort={onSort} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSort).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("columnheader"));
    expect(onSort).toHaveBeenCalledTimes(2);
  });
});
