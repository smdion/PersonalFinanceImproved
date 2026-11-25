/** retirement_settings.withdrawal_routing_mode as read: a mode this version
 *  doesn't know runs as the default, with a note, and is logged once. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredRoutingMode } from "@/lib/db/stored-routing-mode";
import { knownRoutingMode } from "@/lib/config/withdrawal-routing";

afterEach(() => vi.restoreAllMocks());

describe("readStoredRoutingMode", () => {
  it("reads a known mode as itself, with no note and no log", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const mode of ["bracket_filling", "waterfall", "percentage"] as const)
      expect(readStoredRoutingMode(mode)).toEqual({ value: mode, notes: [] });
    expect(logged).not.toHaveBeenCalled();
  });

  it("runs an unknown mode as Bracket Filling, named in a note", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(readStoredRoutingMode("glide_path")).toEqual({
      value: "bracket_filling",
      notes: [
        'The saved withdrawal routing "glide_path" isn\'t one this version knows, so the projection uses Bracket Filling. Update Ledgr or pick a routing under Taxes.',
      ],
    });
  });
});

describe("knownRoutingMode", () => {
  it("knows the modes only, never an inherited key", () => {
    expect(knownRoutingMode("waterfall")).toBe("waterfall");
    for (const other of ["constructor", "toString", "Waterfall", "", null, 3])
      expect(knownRoutingMode(other)).toBeNull();
  });
});
