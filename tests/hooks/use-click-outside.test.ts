import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClickOutside } from "@/lib/hooks/use-click-outside";

function mousedownOn(target: EventTarget) {
  const event = new MouseEvent("mousedown", { bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  document.dispatchEvent(event);
}

describe("useClickOutside", () => {
  it("calls the callback when a mousedown happens outside the ref'd element", () => {
    const onOutsideClick = vi.fn();
    const { result } = renderHook(() => useClickOutside(onOutsideClick));

    const inside = document.createElement("div");
    result.current.current = inside;
    document.body.appendChild(inside);

    const outside = document.createElement("div");
    document.body.appendChild(outside);

    mousedownOn(outside);
    expect(onOutsideClick).toHaveBeenCalledTimes(1);

    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("does not call the callback when a mousedown happens inside the ref'd element", () => {
    const onOutsideClick = vi.fn();
    const { result } = renderHook(() => useClickOutside(onOutsideClick));

    const inside = document.createElement("div");
    const child = document.createElement("span");
    inside.appendChild(child);
    document.body.appendChild(inside);
    result.current.current = inside;

    mousedownOn(child);
    expect(onOutsideClick).not.toHaveBeenCalled();

    document.body.removeChild(inside);
  });

  it("does not call the callback when the ref is not yet attached", () => {
    const onOutsideClick = vi.fn();
    renderHook(() => useClickOutside(onOutsideClick));

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    mousedownOn(outside);

    expect(onOutsideClick).not.toHaveBeenCalled();
    document.body.removeChild(outside);
  });

  it("always invokes the latest callback without reattaching the listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useClickOutside(cb), {
      initialProps: { cb: first },
    });

    const inside = document.createElement("div");
    document.body.appendChild(inside);
    result.current.current = inside;

    rerender({ cb: second });

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    mousedownOn(outside);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("removes the document listener on unmount", () => {
    const onOutsideClick = vi.fn();
    const { unmount } = renderHook(() => useClickOutside(onOutsideClick));
    unmount();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    mousedownOn(outside);

    expect(onOutsideClick).not.toHaveBeenCalled();
    document.body.removeChild(outside);
  });
});
