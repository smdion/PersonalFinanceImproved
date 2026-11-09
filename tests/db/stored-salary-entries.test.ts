/** salary_profiles.salaries is checked once on read and read as stored. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { salaryEntry } from "../helpers/salary-entry";

afterEach(() => vi.restoreAllMocks());

/** The events logged while `run` reads. */
function eventsDuring(run: () => void): unknown[] {
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  run();
  const events = logged.mock.calls.map(([line]) => JSON.parse(String(line)));
  logged.mockRestore();
  return events;
}

/** Entries holding a field the schema doesn't know. */
function withRetiredField(): Record<string, SalaryEntry> {
  const entry = { ...salaryEntry(), retiredField: 1 };
  return { "3": entry };
}

describe("checkSalaryEntries", () => {
  it("returns a valid row's entries as stored, without a log", () => {
    const salaries = { "3": salaryEntry({ salary: 82000 }) };
    const events = eventsDuring(() => {
      const row = checkSalaryEntries({ id: 4, name: "Plan B", salaries });
      expect(row.salaries).toBe(salaries);
      expect(row.name).toBe("Plan B");
    });
    expect(events).toEqual([]);
  });

  it("logs an entry of another shape and keeps it as stored", () => {
    const salaries = withRetiredField();
    const events = eventsDuring(() => {
      expect(checkSalaryEntries({ id: 4, salaries }).salaries).toBe(salaries);
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "salary_entries_unexpected_shape",
        profileId: 4,
      }),
    ]);
  });

  it("logs one refused row once, and another row again", () => {
    const salaries = withRetiredField();
    expect(
      eventsDuring(() => {
        checkSalaryEntries({ id: 7, salaries });
        checkSalaryEntries({ id: 7, salaries });
      }),
    ).toHaveLength(1);
    expect(
      eventsDuring(() => checkSalaryEntries({ id: 8, salaries })),
    ).toHaveLength(1);
  });

  it("reads a row holding no entries as empty", () => {
    eventsDuring(() => {
      expect(checkSalaryEntries({ id: 4, salaries: null }).salaries).toEqual(
        {},
      );
    });
  });
});
