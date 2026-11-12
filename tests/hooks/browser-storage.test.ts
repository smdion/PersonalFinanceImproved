/**
 * Browser storage read through its writer's shape: unset, unreadable or
 * refused reads as unset; a refusal warns once per key, never the value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  isBoolean,
  oneOf,
  parseStoredJson,
  readBrowserJson,
} from "@/lib/hooks/browser-storage";
import { useLocalBoolean } from "@/lib/hooks/use-local-storage";
import { useHistoryWindow } from "@/components/savings/use-history-window";

const isIds = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === "number");

describe("readBrowserJson", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("reads a stored value that fits", () => {
    localStorage.setItem("t:ids", "[1,2]");
    expect(readBrowserJson("t:ids", isIds)).toEqual([1, 2]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads an unset key as unset, with no warning", () => {
    expect(readBrowserJson("t:none", isIds)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads text that isn't JSON or doesn't fit as unset, warning once per key with no value", () => {
    localStorage.setItem("t:bad", '["secret"]');
    expect(readBrowserJson("t:bad", isIds)).toBeUndefined();
    expect(readBrowserJson("t:bad", isIds)).toBeUndefined();
    expect(parseStoredJson("t:text", "{not json", isIds)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("reads storage that throws as unset", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(readBrowserJson("t:ids", isIds)).toBeUndefined();
    get.mockRestore();
  });

  it("checks one of a closed set, as stored", () => {
    const is = oneOf([0, "all"] as const);
    expect([is(0), is("all"), is("0"), is(3)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([isBoolean(false), isBoolean("false")]).toEqual([true, false]);
  });
});

describe("the hooks on a stored value", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a boolean reads its default when the stored value isn't one", () => {
    localStorage.setItem("t:lock", '"yes"');
    expect(
      renderHook(() => useLocalBoolean("t:lock", true)).result.current[0],
    ).toBe(true);
    localStorage.setItem("t:lock2", "false");
    expect(
      renderHook(() => useLocalBoolean("t:lock2", true)).result.current[0],
    ).toBe(false);
  });

  it("a history window reads 0 unless one of its windows is stored", () => {
    localStorage.setItem("ledgr:savings:historyWindow", "5");
    expect(
      renderHook(() => useHistoryWindow("trajectory")).result.current[0],
    ).toBe(0);
    localStorage.setItem("ledgr:savings:txHistoryWindow", '"all"');
    expect(
      renderHook(() => useHistoryWindow("transactions")).result.current[0],
    ).toBe("all");
  });
});
