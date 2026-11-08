import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EditableCell } from "@/components/performance/editable-cell";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";
import { formatCurrency } from "@/lib/utils/format";
import { pressKey } from "./keyboard";

/** One cell driven by the hook the performance table uses. */
function Harness({ onCommit }: { onCommit: (v: string) => void }) {
  const edit = useInlineNumberEdit<"fees">({
    onCommit: (_key, value) => onCommit(value),
  });
  return (
    <table>
      <tbody>
        <tr>
          <EditableCell
            value={1250}
            formatter={formatCurrency}
            isEditing={edit.editingKey === "fees"}
            editValue={edit.editValue}
            onStartEdit={() => edit.startEdit("fees", 1250)}
            onEditValueChange={edit.setEditValue}
            onSaveEdit={edit.commit}
            onKeyDown={edit.handleKeyDown}
            label="Fees, 2025"
          />
        </tr>
      </tbody>
    </table>
  );
}

describe("EditableCell", () => {
  it("shows its value in a button, and a click starts the edit", () => {
    render(<Harness onCommit={vi.fn()} />);
    const button = screen.getByRole("button", { name: "$1,250.00" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(screen.getByRole("textbox", { name: "Fees, 2025" })).toHaveValue(
      "1250",
    );
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j starts the edit, as a click does",
    (key) => {
      render(<Harness onCommit={vi.fn()} />);
      pressKey(screen.getByRole("button", { name: "$1,250.00" }), key);
      expect(screen.getByRole("textbox")).toHaveValue("1250");
    },
  );

  it("guards against a second save from a blur after Enter", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "$1,250.00" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1300" } });
    // Guards against a second commit: both events reach the same render's
    // handlers, so only the edit's own end-once rule stops a second save.
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("1300");
  });

  it("a blur alone saves, on the next edit too", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "$1,250.00" }));
    act(() => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    fireEvent.click(screen.getByRole("button", { name: "$1,250.00" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1400" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith("1400");
  });
});
