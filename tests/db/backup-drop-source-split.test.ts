/** A backup taken while 0008's source_split existed still imports after 0009. */
import { describe, it, expect } from "vitest";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";

describe("backup transform after 0009", () => {
  it("drops investment_transactions.source_split from an 0008-era backup", () => {
    const { tables } = transformBackupToCurrentSchema(
      {
        investment_transactions: [
          {
            id: 1,
            amount: "10.00",
            source_split: { employer: 1, employeeRoth: 0 },
          },
        ],
      },
      "0008_worthless_talisman",
      "0009_icy_black_cat",
    );
    expect(tables.investment_transactions![0]).toEqual({
      id: 1,
      amount: "10.00",
    });
  });
});
