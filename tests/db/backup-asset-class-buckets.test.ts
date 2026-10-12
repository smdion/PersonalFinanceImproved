/** Backups from before 0011 get their bucket links rebuilt; newer ones are left alone. */
import { describe, it, expect } from "vitest";
import {
  REBUILT_ON_RESTORE,
  transformBackupToCurrentSchema,
} from "@/lib/db/backup-transforms";

const classes = () => [
  { id: 1, name: "Example Stocks", composition_bucket: "us_equity" },
  { id: 2, name: "Example Bonds", composition_bucket: "us_bond" },
  { id: 3, name: "Example Spare", composition_bucket: null },
];

describe("asset_class_buckets in backups", () => {
  it("builds each class's link from a pre-0011 backup", () => {
    const { tables } = transformBackupToCurrentSchema(
      { asset_class_params: classes() },
      "0010_red_ink",
      "0011_lumpy_maximus",
    );
    expect(tables.asset_class_buckets).toEqual([
      { bucket: "us_equity", asset_class_id: 1 },
      { bucket: "us_bond", asset_class_id: 2 },
    ]);
  });

  it("does the same for a SQLite-era and an older-era backup", () => {
    for (const version of ["0010_mysterious_black_panther", "v0.7_final"])
      expect(
        transformBackupToCurrentSchema(
          { asset_class_params: classes() },
          version,
          "0011_peaceful_rictor",
        ).tables.asset_class_buckets,
      ).toHaveLength(2);
  });

  it("keeps a newer backup's own links — even none — over the old column", () => {
    const { tables } = transformBackupToCurrentSchema(
      { asset_class_params: classes() }, // nothing linked when it was taken
      "0011_lumpy_maximus",
      "0012_future",
    );
    expect(tables.asset_class_buckets).toBeUndefined();
  });

  it("says where a restore rebuilds the table from", () => {
    expect(REBUILT_ON_RESTORE.asset_class_buckets).toBe("asset_class_params");
  });
});
