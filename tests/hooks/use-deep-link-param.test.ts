/**
 * A link can open a Settings tab/section without saving it; choosing one
 * clears the link's params and saves as usual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/settings",
  useSearchParams: () => search,
}));

import { useDeepLinkParam } from "@/lib/hooks/use-deep-link-param";

const KEYS = ["general", "taxdata", "integrations"];

describe("useDeepLinkParam", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("shows a valid linked value without saving it", () => {
    search = new URLSearchParams("tab=integrations&section=sec");
    const save = vi.fn();
    const { result } = renderHook(() =>
      useDeepLinkParam<string>("tab", KEYS, ["general", save]),
    );
    expect(result.current[0]).toBe("integrations");
    expect(save).not.toHaveBeenCalled();
  });

  it("ignores an unknown linked value", () => {
    search = new URLSearchParams("tab=nope");
    const { result } = renderHook(() =>
      useDeepLinkParam("tab", KEYS, ["taxdata", vi.fn()]),
    );
    expect(result.current[0]).toBe("taxdata");
  });

  it("choosing clears the param (and its dependents) and saves", () => {
    search = new URLSearchParams("tab=integrations&section=sec&x=1");
    const save = vi.fn();
    const { result } = renderHook(() =>
      useDeepLinkParam<string>("tab", KEYS, ["general", save], ["section"]),
    );
    act(() => result.current[1]("taxdata"));
    expect(replace).toHaveBeenCalledWith("/settings?x=1", { scroll: false });
    expect(save).toHaveBeenCalledWith("taxdata");
  });

  it("choosing without link params only saves", () => {
    search = new URLSearchParams();
    const save = vi.fn();
    const { result } = renderHook(() =>
      useDeepLinkParam<string>("tab", KEYS, ["general", save]),
    );
    act(() => result.current[1]("taxdata"));
    expect(replace).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("taxdata");
  });
});
