/**
 * Backups taken on pre-release v0.8.5 builds (tags 0004–0011, squashed into
 * 0004_v085_investments) import as the release shape. Invented rows only.
 */
import { describe, it, expect } from "vitest";
import {
  REBUILT_ON_RESTORE,
  transformBackupToCurrentSchema,
} from "@/lib/db/backup-transforms";

const CURRENT = "0004_v085_investments";

const classes = () => [
  { id: 1, name: "Example Stocks", composition_bucket: "us_equity" },
  { id: 2, name: "Example Bonds", composition_bucket: "us_bond" },
  { id: 3, name: "Example Spare", composition_bucket: null },
];

describe("pre-release v0.8.5 backups", () => {
  it("rebuild each class's link and drop the old column", () => {
    const { tables } = transformBackupToCurrentSchema(
      { asset_class_params: classes() },
      "0010_red_ink",
      CURRENT,
    );
    expect(tables.asset_class_buckets).toEqual([
      { bucket: "us_equity", asset_class_id: 1 },
      { bucket: "us_bond", asset_class_id: 2 },
    ]);
    expect(tables.asset_class_params![0]).toEqual({
      id: 1,
      name: "Example Stocks",
    });
  });

  it("do the same for a SQLite-era and an older-era backup", () => {
    for (const version of ["0010_mysterious_black_panther", "v0.7_final"])
      expect(
        transformBackupToCurrentSchema(
          { asset_class_params: classes() },
          version,
          CURRENT,
        ).tables.asset_class_buckets,
      ).toHaveLength(2);
  });

  it("keep a backup's own links — even none — once the table exists", () => {
    const { tables } = transformBackupToCurrentSchema(
      { asset_class_params: classes() }, // nothing linked when it was taken
      "0011_lumpy_maximus",
      CURRENT,
    );
    expect(tables.asset_class_buckets).toBeUndefined();
    // Every later tag too — including the v0.9 line, which continues the
    // same ordered list (a tag missing from it reads as "older than the
    // table" and would re-link a household's deliberately empty links).
    for (const version of [
      "0012_v0814_perf_annotations",
      "0000_v9_initial_schema",
      "0004_v090_debts",
      "0016_v090_debts",
    ])
      expect(
        transformBackupToCurrentSchema(
          { asset_class_params: classes() },
          version,
          "0004_v090_debts",
        ).tables.asset_class_buckets,
      ).toBeUndefined();
  });

  it("send hand-set transaction kinds back to the built-in rules, keeping ingest locks", () => {
    const { tables } = transformBackupToCurrentSchema(
      {
        investment_transactions: [
          {
            id: 1,
            amount: "10.00",
            kind_override: "contribution",
            kind_override_source: "user",
          },
          {
            id: 2,
            amount: "-5.00",
            kind_override: "withdrawal",
            kind_override_source: "ingest_redacted",
          },
          {
            id: 3,
            amount: "7.00",
            source_split: { employer: 1, employeeRoth: 0 },
          },
        ],
      },
      "0008_worthless_talisman",
      CURRENT,
    );
    expect(tables.investment_transactions).toEqual([
      { id: 1, amount: "10.00", kind_override: null },
      { id: 2, amount: "-5.00", kind_override: "withdrawal" },
      { id: 3, amount: "7.00" },
    ]);
  });

  it("say where a restore rebuilds the links from", () => {
    expect(REBUILT_ON_RESTORE.asset_class_buckets).toBe("asset_class_params");
  });
});
