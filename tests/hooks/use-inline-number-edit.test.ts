import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";

type CellKey = { type: "annual" | "account"; id: number; field: string };

/** handleKeyDown only reads `.key` and calls `.preventDefault()` — a full
 *  React.KeyboardEvent is impractical to construct in a unit test. */
function fakeKeyEvent(key: string): React.KeyboardEvent {
  // eslint-disable-next-line no-restricted-syntax -- minimal synthetic event stub, see comment above
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

describe("useInlineNumberEdit", () => {
  it("starts with no active edit", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineNumberEdit({ onCommit }));
    expect(result.current.editingKey).toBeNull();
    expect(result.current.editValue).toBe("");
  });

  it("startEdit seeds editValue from the current value", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit(
        { type: "annual", id: 1, field: "fees" },
        123.45,
      ),
    );

    expect(result.current.editingKey).toEqual({
      type: "annual",
      id: 1,
      field: "fees",
    });
    expect(result.current.editValue).toBe("123.45");
  });

  it("commit fires onCommit with the trimmed draft and clears editingKey", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "account", id: 5, field: "fees" }, 0),
    );
    act(() => result.current.setEditValue("  250  "));
    act(() => result.current.commit());

    expect(onCommit).toHaveBeenCalledWith(
      { type: "account", id: 5, field: "fees" },
      "250",
    );
    expect(result.current.editingKey).toBeNull();
  });

  it("commit with a blank draft silently cancels without calling onCommit", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "annual", id: 1, field: "fees" }, 10),
    );
    act(() => result.current.setEditValue("   "));
    act(() => result.current.commit());

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editingKey).toBeNull();
  });

  it("commit with no active edit is a no-op", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancel clears editingKey without calling onCommit", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "annual", id: 1, field: "fees" }, 10),
    );
    act(() => result.current.cancel());

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editingKey).toBeNull();
  });

  it("handleKeyDown commits on Enter", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "annual", id: 1, field: "fees" }, 10),
    );
    act(() => result.current.setEditValue("20"));
    act(() => result.current.handleKeyDown(fakeKeyEvent("Enter")));

    expect(onCommit).toHaveBeenCalledWith(
      { type: "annual", id: 1, field: "fees" },
      "20",
    );
  });

  it("handleKeyDown cancels on Escape without committing", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "annual", id: 1, field: "fees" }, 10),
    );
    act(() => result.current.setEditValue("20"));
    act(() => result.current.handleKeyDown(fakeKeyEvent("Escape")));

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editingKey).toBeNull();
  });

  it("starting a new edit while one is active replaces it (no commit of the old one)", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useInlineNumberEdit<CellKey>({ onCommit }),
    );

    act(() =>
      result.current.startEdit({ type: "annual", id: 1, field: "fees" }, 10),
    );
    act(() => result.current.setEditValue("20"));
    act(() =>
      result.current.startEdit({ type: "annual", id: 2, field: "fees" }, 30),
    );

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editingKey).toEqual({
      type: "annual",
      id: 2,
      field: "fees",
    });
    expect(result.current.editValue).toBe("30");
  });
});
