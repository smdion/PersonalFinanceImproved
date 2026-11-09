/** salary_profiles.salaries is checked once on read and read as stored. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import { log } from "@/lib/logger";
import { salaryEntry } from "../helpers/salary-entry";

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

describe("checkSalaryEntries", () => {
  beforeEach(() => vi.mocked(log).mockClear());

  it("returns a valid row's entries as stored, without a log", () => {
    const salaries = { "3": salaryEntry({ salary: 82000 }) };
    const row = checkSalaryEntries({ id: 4, name: "Plan B", salaries });
    expect(row.salaries).toBe(salaries);
    expect(row.name).toBe("Plan B");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs an entry of another shape and keeps it as stored", () => {
    const entry = { ...salaryEntry(), retiredField: 1 };
    const salaries: Record<string, SalaryEntry> = { "3": entry };
    const row = checkSalaryEntries({ id: 4, salaries });
    expect(row.salaries["3"]).toBe(entry);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "salary_entries_unexpected_shape",
      expect.objectContaining({ profileId: 4 }),
    );
  });

  it("reads a row holding no entries as empty", () => {
    expect(checkSalaryEntries({ id: 4, salaries: null }).salaries).toEqual({});
  });
});
