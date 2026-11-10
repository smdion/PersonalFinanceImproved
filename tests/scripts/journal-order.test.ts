/** Each drizzle journal's `when` values rise strictly, as check:migrations checks. */
import { describe, it, expect } from "vitest";
import { nonRisingWhen } from "../../scripts/journal-order";
import pgJournal from "../../drizzle/meta/_journal.json";
import sqliteJournal from "../../drizzle-sqlite/meta/_journal.json";

describe("nonRisingWhen", () => {
  it("passes both shipped journals", () => {
    expect(nonRisingWhen(pgJournal.entries)).toEqual([]);
    expect(nonRisingWhen(sqliteJournal.entries)).toEqual([]);
  });

  it("names each entry whose `when` repeats or falls", () => {
    expect(
      nonRisingWhen([
        { tag: "0000_a", when: 10 },
        { tag: "0001_b", when: 20 },
        { tag: "0002_c", when: 20 },
        { tag: "0003_d", when: 15 },
        { tag: "0004_e", when: 30 },
      ]),
    ).toEqual(["0002_c", "0003_d"]);
  });
});
