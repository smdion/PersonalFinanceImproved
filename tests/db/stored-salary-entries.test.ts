/** salary_profiles.salaries is checked once on read; another shape throws. */
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

  it("throws on an entry of another shape, naming the profile, and logs it once", () => {
    const salaries = withRetiredField();
    const events = eventsDuring(() => {
      for (let i = 0; i < 2; i++)
        expect(() => checkSalaryEntries({ id: 4, salaries })).toThrow(
          "Salary Profile 4: its stored entries don't fit their shape",
        );
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "salary_entries_unexpected_shape",
        profileId: 4,
      }),
    ]);
  });

  it.each([
    ["a JSON null", null],
    ["an array", [salaryEntry()]],
    ["a scalar", 42],
    ["a double-encoded string", JSON.stringify({ "3": salaryEntry() })],
  ])("throws on a root that is %s", (_, root) => {
    eventsDuring(() => {
      expect(() =>
        checkSalaryEntries({
          id: 5,
          // eslint-disable-next-line no-restricted-syntax -- a stored root of any shape, as the column can hold it
          salaries: root as unknown as Record<string, SalaryEntry>,
        }),
      ).toThrow("Salary Profile 5");
    });
  });
});
