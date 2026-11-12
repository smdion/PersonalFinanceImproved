/**
 * A profile-id setting reads as an id however it was stored: a numeric
 * string an older PostgreSQL write left still names its profile, so the
 * active profile is never "repaired" away from it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useIntegerSetting,
  useProfileIdSetting,
} from "@/lib/hooks/use-profile-id-setting";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import {
  mutationCalls,
  resetTrpcMock,
  setQuery,
} from "../components/trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

const KEY = "active_retirement_profile_id";

beforeEach(() => {
  localStorage.clear();
  resetTrpcMock();
  setQuery("retirement.retirementProfiles.list", [{ id: 1 }, { id: 2 }]);
});

describe("useProfileIdSetting", () => {
  it.each([
    [2, 2],
    ["2", 2],
    ["two", null],
    [null, null],
  ])("reads a stored %j as %j", (stored, id) => {
    setQuery("settings.appSettings.list", [{ key: KEY, value: stored }]);
    expect(renderHook(() => useProfileIdSetting(KEY)).result.current[0]).toBe(
      id,
    );
  });

  it("keeps an active profile stored as a numeric string (no repair write)", () => {
    setQuery("settings.appSettings.list", [{ key: KEY, value: "2" }]);
    const { result } = renderHook(() => useActiveRetirementProfile());
    expect(result.current[0]).toBe(2);
    expect(mutationCalls("settings.appSettings.upsert")).toEqual([]);
  });
});

describe("useIntegerSetting", () => {
  it.each([
    [1, 1],
    ["1", 1],
    ["one", 0],
    [null, 0],
  ])("reads a budget column stored as %j as %j", (stored, column) => {
    setQuery("settings.appSettings.list", [
      { key: "budget_active_column", value: stored },
    ]);
    expect(
      renderHook(() => useIntegerSetting("budget_active_column", 0)).result
        .current[0],
    ).toBe(column);
  });
});

describe("useIntegerSetting: the budget's name-column width", () => {
  it.each([
    [200, 200],
    ["200", 200],
    [192.5, 192],
  ])(
    "reads a width stored as %j as %j (a fractional width reads as unset)",
    (stored, width) => {
      setQuery("settings.appSettings.list", [
        { key: "budget_name_col_width", value: stored },
      ]);
      expect(
        renderHook(() => useIntegerSetting("budget_name_col_width", 192)).result
          .current[0],
      ).toBe(width);
    },
  );
});
