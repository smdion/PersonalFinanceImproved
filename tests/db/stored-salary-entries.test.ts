/** salary_profiles.salaries is checked entry by entry on read; one of another
 *  shape is left out and named, and stays stored. */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkSalaryEntries,
  unreadableSalaryNotes,
  withUnreadableEntries,
} from "@/lib/db/stored-salary-entries";
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

  it("reads past a key the entry's shape doesn't know (a newer Ledgr's), returning the entries as stored", () => {
    const salaries = withRetiredField();
    const events = eventsDuring(() => {
      expect(checkSalaryEntries({ id: 4, salaries }).salaries).toBe(salaries);
    });
    expect(events).toEqual([]);
  });

  it("leaves out an entry of another shape, keeping the rest, and logs it once", () => {
    const salaries = {
      ...withRetiredField(),
      "4": Object.assign(salaryEntry(), { payPeriod: "quadweekly" }),
    };
    const events = eventsDuring(() => {
      for (let i = 0; i < 2; i++) {
        const row = checkSalaryEntries({ id: 4, name: "Plan B", salaries });
        expect(Object.keys(row.salaries)).toEqual(["3"]);
        expect(row.unreadable).toEqual({
          entries: { "4": salaries["4"] },
          root: false,
        });
      }
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "salary_entries_unexpected_shape",
        profileId: 4,
        job: "4",
      }),
    ]);
  });

  it.each([
    ["a JSON null", null],
    ["an array", [salaryEntry()]],
    ["a scalar", 42],
    ["a double-encoded string", JSON.stringify({ "3": salaryEntry() })],
  ])("reads a root that is %s as no entries, marked unreadable", (_, root) => {
    eventsDuring(() => {
      const row = checkSalaryEntries({
        id: 5,
        // eslint-disable-next-line no-restricted-syntax -- a stored root of any shape, as the column can hold it
        salaries: root as unknown as Record<string, SalaryEntry>,
      });
      expect(row.salaries).toEqual({});
      expect(row.unreadable).toEqual({ entries: {}, root: true });
    });
  });
});

describe("withUnreadableEntries", () => {
  it("puts each unreadable entry back as stored unless the save sets that job", () => {
    const unreadable = {
      entries: { "4": { payPeriod: "x" }, "5": 1 },
      root: false,
    };
    const next = { "3": salaryEntry(), "5": salaryEntry({ salary: 1 }) };
    expect(withUnreadableEntries(unreadable, next)).toEqual({
      "4": { payPeriod: "x" },
      ...next,
    });
  });
});

describe("unreadableSalaryNotes", () => {
  const jobs = [{ id: 4, employerName: "Invented Co" }];

  it("names each unreadable entry by its job's employer, and skips a job that is gone", () => {
    expect(
      unreadableSalaryNotes(
        {
          name: "Plan B",
          unreadable: { entries: { "4": {}, "99": {} }, root: false },
        },
        jobs,
      ),
    ).toEqual([
      'The saved salary for Invented Co in Salary Profile "Plan B" can\'t be read by this version of Ledgr, so that job has none there. Update Ledgr, or enter it again.',
    ]);
  });

  it("names an unreadable root once", () => {
    expect(
      unreadableSalaryNotes(
        { name: "Plan B", unreadable: { entries: {}, root: true } },
        jobs,
      ),
    ).toEqual([
      'The saved salaries in Salary Profile "Plan B" can\'t be read by this version of Ledgr, so it has none. Update Ledgr, or enter them again.',
    ]);
  });
});
