/** A backup's timestamps in the target dialect's form: SQLite epoch seconds
 *  become PostgreSQL text and back, by the schema's timestamp columns; a
 *  value that isn't a time refuses, naming table and column only. */
import { describe, it, expect } from "vitest";
import { convertTimestampsFor } from "@/lib/db/backup/restore-timestamps";

const SECONDS = 1794202284;
const ISO = new Date(SECONDS * 1000).toISOString();
/** The same instant as node-postgres hands timestamptz text over. */
const PG_TEXT = ISO.replace("T", " ").replace(".000Z", "+00");

const backup = (createdAt: unknown) => ({
  budget_profiles: [{ id: 1, name: "Invented", created_at: createdAt }],
  people: [{ id: 2, name: "Invented", date_of_birth: "1980-01-01" }],
});

describe("convertTimestampsFor", () => {
  it.each([
    ["SQLite seconds onto PostgreSQL", SECONDS, "postgres", ISO],
    ["PostgreSQL text onto SQLite", PG_TEXT, "sqlite", SECONDS],
    [
      "PostgreSQL text onto PostgreSQL, as stored",
      PG_TEXT,
      "postgres",
      PG_TEXT,
    ],
    ["SQLite seconds onto SQLite, as stored", SECONDS, "sqlite", SECONDS],
    ["a null, as stored", null, "postgres", null],
    // v0.1.0's PostgreSQL schema stored plain `timestamp`: text with no offset, in UTC.
    [
      "v0.1.0 PostgreSQL text (no offset) onto SQLite, as UTC",
      "2026-11-09 07:31:24",
      "sqlite",
      Date.UTC(2026, 10, 9, 7, 31, 24) / 1000,
    ],
    [
      "v0.1.0 PostgreSQL text (no offset) onto PostgreSQL, marked UTC",
      "2026-03-19 12:34:56.123456",
      "postgres",
      "2026-03-19 12:34:56.123456Z",
    ],
    // A year below 100 and the offset forms PostgreSQL writes, each read field by field.
    [
      "year 0050 onto SQLite",
      "0050-06-01 00:00:00+00",
      "sqlite",
      Date.parse("0050-06-01T00:00:00Z") / 1000,
    ],
    [
      "a -05:30 offset onto SQLite",
      "2026-11-09 07:31:24.5-05:30",
      "sqlite",
      Date.parse("2026-11-09T13:01:24Z") / 1000,
    ],
    [
      "a +0530 offset onto SQLite",
      "2026-11-09 07:31+0530",
      "sqlite",
      Date.parse("2026-11-09T02:01:00Z") / 1000,
    ],
  ] as const)("%s", (_, stored, target, written) => {
    const tables = backup(stored);
    convertTimestampsFor(tables, target);
    expect(tables.budget_profiles[0]!.created_at).toBe(written);
  });

  it("leaves every other column as it is (a date stays its text)", () => {
    const tables = backup(SECONDS);
    convertTimestampsFor(tables, "postgres");
    expect(tables.people[0]).toEqual({
      id: 2,
      name: "Invented",
      date_of_birth: "1980-01-01",
    });
  });

  it("refuses a value that isn't a time, naming table and column, never the value", () => {
    expect(() =>
      convertTimestampsFor(backup("Invented secret"), "sqlite"),
    ).toThrow(
      "This backup holds values that aren't a time in budget_profiles.created_at. Nothing was restored.",
    );
    for (const loose of [
      "Invented 1",
      "12",
      "2026-11-09",
      "07:31:24",
      "2024-02-30 10:00:00+00",
      "2026-11-09T24:00:00Z",
      "0000-01-01 00:00:00",
      "2020-01-01 00:00:00+99:99",
      "2020-01-01 00:00:00+16",
      "2020-01-01 00:00:00+00:60",
      "0001-01-01T00:00+05:00", // 0000-12-31 in UTC
    ])
      expect(() => convertTimestampsFor(backup(loose), "sqlite")).toThrow(
        "aren't a time in budget_profiles.created_at",
      );
    for (const notATime of [
      true,
      1e20,
      1e12,
      -1e12,
      -62167219200, // 0000-01-01
      Number.POSITIVE_INFINITY,
    ])
      for (const target of ["postgres", "sqlite"] as const)
        expect(() => convertTimestampsFor(backup(notATime), target)).toThrow(
          "aren't a time in budget_profiles.created_at",
        );
  });
});
