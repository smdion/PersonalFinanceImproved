/**
 * An app_settings value is checked once on read; a value its writer's
 * shape refuses (an older install's value) passes on as stored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
  checkStoredStamp,
  findStoredStamp,
  readStoredSetting,
} from "@/lib/db/stored-setting";

vi.mock("@/lib/db/schema", () => ({}));

afterEach(() => vi.restoreAllMocks());

const state = z.object({ date: z.string(), attempts: z.number() });

describe("readStoredSetting", () => {
  it("returns a value in its writer's shape without a warning", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const value = { date: "2026-03-02", attempts: 2 };
    expect(readStoredSetting("test_state_ok", value, state)).toBe(value);
    expect(logged).not.toHaveBeenCalled();
  });

  it("passes a refused value on as stored and warns once per key", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const value = { date: 20260302, attempts: "2" };
    expect(readStoredSetting("test_state_bad", value, state)).toBe(value);
    expect(readStoredSetting("test_state_bad", value, state)).toBe(value);
    expect(logged).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(logged.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      level: "warn",
      event: "stored_value_unexpected_shape",
      source: "app_settings.test_state_bad",
    });
  });
});

describe("findStoredStamp", () => {
  const rows = [
    { key: "test_stamp_ok", value: "2026-03-02T10:00:00.000Z" },
    { key: "test_stamp_number", value: 1772445600000 },
  ];

  it("reads a stamp by key, and an unset one as undefined", () => {
    expect(findStoredStamp(rows, "test_stamp_ok")).toBe(
      "2026-03-02T10:00:00.000Z",
    );
    expect(findStoredStamp(rows, "test_stamp_unset")).toBeUndefined();
  });

  it("passes a stamp stored as another type on as stored", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(findStoredStamp(rows, "test_stamp_number")).toBe(1772445600000);
  });
});

describe("checkStoredStamp", () => {
  it("fits a string stamp and an unset one", () => {
    expect(checkStoredStamp("test_check_ok", "2026-03-02")).toEqual({
      fits: true,
      value: "2026-03-02",
    });
    expect(checkStoredStamp("test_check_unset", undefined)).toEqual({
      fits: true,
      value: undefined,
    });
  });

  it.each([
    ["number", 1772445600000],
    ["JSON null", null],
    ["object", {}],
  ])("marks a %s stamp as stored and warns once", (label, value) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const read = checkStoredStamp(`test_check_${label}`, value);
    checkStoredStamp(`test_check_${label}`, value);
    expect(read.fits).toBe(false);
    expect(!read.fits && read.asStored).toBe(value);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
