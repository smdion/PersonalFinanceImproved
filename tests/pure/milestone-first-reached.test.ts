import { describe, it, expect } from "vitest";
import {
  isNewlyReached,
  mergeFirstReached,
  parseFirstReached,
} from "@/lib/pure/milestone-first-reached";

describe("mergeFirstReached", () => {
  it("the first recording keeps what's already reached undated, or dated by the history", () => {
    expect(
      mergeFirstReached(
        null,
        [
          { id: "foo1", reachedYear: null },
          { id: "first100k", reachedYear: 2019 },
          { id: "zero", reachedYear: 2026 },
        ],
        "2026-10-29",
      ),
    ).toEqual({
      since: "2026-10-29",
      reached: { foo1: "", first100k: "2019", zero: "" },
    });
  });

  it("later, a newly reached milestone gets the day; recorded ones never change", () => {
    const existing = { since: "2026-10-01", reached: { foo1: "" } };
    expect(
      mergeFirstReached(
        existing,
        [
          { id: "foo1", reachedYear: null },
          { id: "foo2", reachedYear: null },
        ],
        "2026-10-29",
      ),
    ).toEqual({
      since: "2026-10-01",
      reached: { foo1: "", foo2: "2026-10-29" },
    });
  });

  it("null when nothing changes", () => {
    const existing = { since: "2026-10-01", reached: { foo1: "" } };
    expect(
      mergeFirstReached(
        existing,
        [{ id: "foo1", reachedYear: null }],
        "2026-10-29",
      ),
    ).toBeNull();
  });
});

describe("isNewlyReached", () => {
  const record = {
    since: "2026-09-01",
    reached: { a: "2026-10-01", b: "2026-09-29", c: "2019", d: "" },
  };
  it("a full date within 30 days", () => {
    expect(isNewlyReached(record, "a", "2026-10-29")).toBe(true);
    expect(isNewlyReached(record, "b", "2026-10-29")).toBe(false);
  });
  it("never a year, an undated one or an unknown id", () => {
    for (const id of ["c", "d", "e"])
      expect(isNewlyReached(record, id, "2026-10-29")).toBe(false);
  });
});

describe("parseFirstReached", () => {
  it("reads a valid record and drops anything else", () => {
    expect(
      parseFirstReached({ since: "2026-10-01", reached: { a: "2026" } }),
    ).toEqual({
      since: "2026-10-01",
      reached: { a: "2026" },
    });
    expect(parseFirstReached({ a: "2026-10-01" })).toBeNull();
    expect(parseFirstReached(null)).toBeNull();
  });
});
