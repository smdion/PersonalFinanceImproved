/**
 * The snapshot sub-row label: one function for the Portfolio page's
 * snapshot history and the New Snapshot form (they were two copies).
 * DESIGN.md "Snapshot Display".
 */
import { describe, it, expect } from "vitest";
import {
  snapshotRowLabel,
  type SnapshotRowLabelInput,
} from "@/lib/pure/accounts/snapshot-row-label";

const row = (o: Partial<SnapshotRowLabelInput>): SnapshotRowLabelInput => ({
  owner: null,
  taxType: "preTax",
  label: null,
  subType: null,
  accountType: "401k",
  perfAccountType: "401k",
  ...o,
});

describe("snapshotRowLabel", () => {
  it("same type as the performance account: the tax label alone", () => {
    expect(snapshotRowLabel(row({}))).toBe("Traditional");
    expect(snapshotRowLabel(row({ taxType: "taxFree" }))).toBe("Roth");
  });

  it("the type compare ignores case", () => {
    expect(
      snapshotRowLabel(
        row({ accountType: "HSA", perfAccountType: "hsa", taxType: "hsa" }),
      ),
    ).toBe("HSA");
  });

  it("a type other than the performance account's: its display label, tax in parens", () => {
    expect(
      snapshotRowLabel(row({ accountType: "ira", perfAccountType: "401k" })),
    ).toBe("IRA (Traditional)");
  });

  it("an unlinked row (no performance account) shows its type", () => {
    expect(
      snapshotRowLabel(
        row({ accountType: "hsa", perfAccountType: null, taxType: "hsa" }),
      ),
    ).toBe("HSA");
    expect(snapshotRowLabel(row({ perfAccountType: null }))).toBe(
      "401k (Traditional)",
    );
  });

  it("label wins over subType, subType over the type", () => {
    expect(
      snapshotRowLabel(row({ subType: "Employer Match", label: "Rollover" })),
    ).toBe("Rollover (Traditional)");
    expect(snapshotRowLabel(row({ subType: "Employer Match" }))).toBe(
      "Employer Match (Traditional)",
    );
    // An empty label falls through to subType.
    expect(
      snapshotRowLabel(row({ label: "", subType: "Employer Match" })),
    ).toBe("Employer Match (Traditional)");
  });

  it("a sub-type equal to the tax label shows once", () => {
    expect(snapshotRowLabel(row({ subType: "Roth", taxType: "taxFree" }))).toBe(
      "Roth",
    );
  });

  it("owner prefix: an em dash, then type · tax", () => {
    expect(snapshotRowLabel(row({ owner: "Avery" }))).toBe(
      "Avery — Traditional",
    );
    expect(
      snapshotRowLabel(row({ owner: "Avery", subType: "Employer Match" })),
    ).toBe("Avery — Employer Match · Traditional");
    // The form passes "Joint" for a row with no owner.
    expect(snapshotRowLabel(row({ owner: "Joint", taxType: "afterTax" }))).toBe(
      "Joint — After-tax",
    );
  });

  it("an empty owner gives no prefix", () => {
    expect(snapshotRowLabel(row({ owner: "" }))).toBe("Traditional");
  });

  it("an unknown tax type shows as stored", () => {
    expect(snapshotRowLabel(row({ taxType: "mystery" }))).toBe("mystery");
  });
});
