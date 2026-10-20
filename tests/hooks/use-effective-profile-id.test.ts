/**
 * useEffectiveProfileId — single resolver for "which profile does this page
 * show". Precedence: the page's own local selection (What-If sandbox, a
 * profile manager's "editing" pick) -> the active profile. A Plan is not a
 * tier: applying one makes its profiles the active ones.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";

const resolve = (localSelection: number | null, validIds?: number[]) =>
  renderHook(() =>
    useEffectiveProfileId("budget", {
      validIds,
      localSelection,
      globalDefaultId: 1,
    }),
  ).result.current;

describe("useEffectiveProfileId", () => {
  it("returns the active profile when the page has no selection", () => {
    expect(resolve(null, [1, 2, 3])).toEqual({
      profileId: 1,
      source: "global-default",
    });
  });

  it("a local selection wins over the active profile", () => {
    expect(resolve(2, [1, 2, 3])).toEqual({
      profileId: 2,
      source: "user-selection",
    });
  });

  it("a local selection of a deleted profile falls back to the active one", () => {
    expect(resolve(9, [1, 2, 3])).toEqual({
      profileId: 1,
      source: "global-default",
    });
  });

  it("trusts the local selection while the profile list is still loading", () => {
    expect(resolve(2, undefined).profileId).toBe(2);
  });
});
