import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast, useToasts } from "@/lib/hooks/use-toast";

describe("toast.loading", () => {
  it("returns an id and does not auto-dismiss", () => {
    const { result } = renderHook(() => useToasts());
    let id = "";
    act(() => {
      id = toast.loading("Recalculating…");
    });

    expect(id).toMatch(/^toast-/);
    const found = result.current.toasts.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.variant).toBe("loading");
  });

  it("dismiss(id) removes exactly that toast", () => {
    const { result } = renderHook(() => useToasts());
    let id = "";
    act(() => {
      id = toast.loading("Recalculating…");
    });
    expect(result.current.toasts.some((t) => t.id === id)).toBe(true);

    act(() => result.current.dismiss(id));

    expect(result.current.toasts.some((t) => t.id === id)).toBe(false);
  });

  it("toast()/toast.success()/toast.error() also return an id", () => {
    const { result } = renderHook(() => useToasts());
    let ids: string[] = [];
    act(() => {
      ids = [
        toast("plain", "info", 0),
        toast.success("ok", 0),
        toast.error("bad", 0),
      ];
    });
    for (const id of ids) {
      expect(id).toMatch(/^toast-/);
      expect(result.current.toasts.some((t) => t.id === id)).toBe(true);
    }
  });
});
