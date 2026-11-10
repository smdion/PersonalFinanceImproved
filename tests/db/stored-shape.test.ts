/**
 * The one stored-shape reader: a value its shape accepts comes back as
 * itself; a refused one (any root a hand edit or an older install left) is
 * logged once and comes back marked as stored, for its reader to decide.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { passOnAsStored, readStoredShape } from "@/lib/db/stored-shape";

afterEach(() => vi.restoreAllMocks());

const counts = z.record(z.string(), z.number());
const smallCounts = z.record(z.string(), z.number().max(9));

function logFor(source: string) {
  return {
    event: "test_stored_shape",
    key: () => source,
    data: (issues: string[]) => ({ source, issues }),
  };
}

describe("readStoredShape", () => {
  it("returns a fitting value itself, never a parsed copy, without a warning", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const value = { a: 1 };
    const read = readStoredShape(value, counts, logFor("fits"));
    expect(read).toEqual({ fits: true, value });
    expect(read.fits && read.value).toBe(value);
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON null", null],
    ["array", [1]],
    ["scalar", 7],
    ["double-encoded string", '{"a":1}'],
  ])("marks a %s root as stored and warns once", (label, root) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const read = readStoredShape(root, counts, logFor(`root ${label}`));
    readStoredShape(root, counts, logFor(`root ${label}`));
    expect(read.fits).toBe(false);
    expect(!read.fits && read.asStored).toBe(root);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "test_stored_shape",
      source: `root ${label}`,
    });
  });

  it("checks the stricter shapes after the first, issues in that order", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const read = readStoredShape({ a: "x", b: 12 }, counts, logFor("order"), [
      smallCounts,
    ]);
    expect(!read.fits && read.issues).toEqual([
      "a: Invalid input: expected number, received string",
      "a: Invalid input: expected number, received string",
      "b: Too big: expected number to be <=9",
    ]);
  });
});

describe("passOnAsStored", () => {
  it("passes a fitting value and a refused one on as stored", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const refused = [1];
    expect(
      passOnAsStored(readStoredShape({ a: 1 }, counts, logFor("p1"))),
    ).toEqual({ a: 1 });
    expect(passOnAsStored(readStoredShape(refused, counts, logFor("p2")))).toBe(
      refused,
    );
  });
});
