/**
 * A backup's ON DELETE SET NULL links whose parent row it lacks are set to
 * null before the insert, as the key would have; every other link, and a
 * link whose parent table the backup doesn't hold, stays as stored.
 */
import { describe, it, expect, vi } from "vitest";
import { nullDanglingLinks } from "@/lib/db/backup/restore-dangling-links";
import { log } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

const people = () => [
  { id: 1, name: "Invented Earner", spouse_person_id: 2 },
  { id: 2, name: "Invented Spouse", spouse_person_id: 1 },
  { id: 3, name: "Invented Widow", spouse_person_id: 9 },
];

describe("nullDanglingLinks", () => {
  it("nulls a spouse link whose person the backup lacks, and keeps the rest", () => {
    const tables = { people: people() };
    const { tables: out, linkNotes } = nullDanglingLinks(tables, "import");
    expect(out["people"]).toEqual([
      { id: 1, name: "Invented Earner", spouse_person_id: 2 },
      { id: 2, name: "Invented Spouse", spouse_person_id: 1 },
      { id: 3, name: "Invented Widow", spouse_person_id: null },
    ]);
    expect(linkNotes).toEqual([
      { table: "people", column: "spouse_person_id", rows: 1 },
    ]);
    expect(tables.people[2]!.spouse_person_id).toBe(9);
  });

  it("nulls an RMD target whose account the backup lacks, matching ids across text and numbers", () => {
    const { tables: out } = nullDanglingLinks(
      {
        performance_accounts: [{ id: "81" }],
        retirement_settings: [
          { id: 1, rmd_excess_target_performance_account_id: 81 },
          { id: 2, rmd_excess_target_performance_account_id: 82 },
          { id: 3, rmd_excess_target_performance_account_id: null },
        ],
      },
      "restore",
    );
    expect(
      out["retirement_settings"]!.map(
        (r) =>
          (r as Record<string, unknown>)[
            "rmd_excess_target_performance_account_id"
          ],
      ),
    ).toEqual([81, null, null]);
  });

  it("leaves a link alone when the backup holds no parent table, and a key that isn't SET NULL alone", () => {
    const tables = {
      retirement_settings: [
        { id: 1, person_id: 99, rmd_excess_target_performance_account_id: 82 },
      ],
      people: [{ id: 1 }],
    };
    const { tables: out, linkNotes } = nullDanglingLinks(tables, "import");
    expect(out).toEqual(tables);
    expect(linkNotes).toEqual([]);
  });

  it("warns naming the table, column and row ids, never a stored value", () => {
    vi.mocked(log).mockClear();
    nullDanglingLinks({ people: people() }, "restore");
    expect(log).toHaveBeenCalledWith("warn", "backup_dangling_link_nulled", {
      from: "restore",
      table: "people",
      column: "spouse_person_id",
      rowIds: [3],
      rows: 1,
    });
  });
});
