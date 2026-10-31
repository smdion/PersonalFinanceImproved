import { describe, it, expect } from "vitest";
import {
  isPullOnlyLocalId,
  allowedDirectionsForLocalId,
  allowedDirectionsForMapping,
  localTargetsPulledTwice,
  mappingWithTypedIds,
  mappingsWithTypedIds,
  remotesPulledTwice,
} from "@/lib/utils/account-mapping";
import type { AccountMapping } from "@/lib/db/schema";

describe("mappingWithTypedIds", () => {
  it("populates performanceAccountId from legacy localId", () => {
    const input: AccountMapping = {
      localId: "performance:42",
      localName: "Alice 401k",
      remoteAccountId: "remote-1",
      syncDirection: "push",
    };
    expect(mappingWithTypedIds(input)).toEqual({
      ...input,
      performanceAccountId: 42,
    });
  });

  it("populates assetId from legacy localId", () => {
    const input: AccountMapping = {
      localId: "asset:7",
      localName: "Mazda3",
      remoteAccountId: "remote-2",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input)).toEqual({ ...input, assetId: 7 });
  });

  it("populates loanId and loanMapType from mortgage localId", () => {
    const input: AccountMapping = {
      localId: "mortgage:3:propertyValue",
      localName: "Home Value",
      remoteAccountId: "remote-3",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input)).toEqual({
      ...input,
      loanId: 3,
      loanMapType: "propertyValue",
    });
  });

  it("populates loanBalance variant", () => {
    const input: AccountMapping = {
      localId: "mortgage:9:loanBalance",
      localName: "Loan",
      remoteAccountId: "remote-4",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input).loanMapType).toBe("loanBalance");
  });

  it("does not overwrite an explicit performanceAccountId", () => {
    const input: AccountMapping = {
      localId: "performance:42",
      localName: "Already typed",
      remoteAccountId: "r",
      syncDirection: "push",
      performanceAccountId: 99,
    };
    expect(mappingWithTypedIds(input).performanceAccountId).toBe(99);
  });

  it("does not overwrite an explicit assetId", () => {
    const input: AccountMapping = {
      localId: "asset:1",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
      assetId: 5,
    };
    expect(mappingWithTypedIds(input).assetId).toBe(5);
  });

  it("does not overwrite an explicit loan pair", () => {
    const input: AccountMapping = {
      localId: "mortgage:1:propertyValue",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
      loanId: 7,
      loanMapType: "loanBalance",
    };
    const result = mappingWithTypedIds(input);
    expect(result.loanId).toBe(7);
    expect(result.loanMapType).toBe("loanBalance");
  });

  it("returns mapping unchanged when localId is missing", () => {
    const input: AccountMapping = {
      localName: "no-localid",
      remoteAccountId: "r",
      syncDirection: "push",
    };
    expect(mappingWithTypedIds(input)).toBe(input);
  });

  it("returns mapping unchanged for unrecognized localId prefix", () => {
    const input: AccountMapping = {
      localId: "unknown:42",
      localName: "weird",
      remoteAccountId: "r",
      syncDirection: "push",
    };
    expect(mappingWithTypedIds(input)).toBe(input);
  });

  it("rejects non-numeric performance id", () => {
    const input: AccountMapping = {
      localId: "performance:abc",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "push",
    };
    expect(mappingWithTypedIds(input).performanceAccountId).toBeUndefined();
  });

  it("rejects non-numeric asset id", () => {
    const input: AccountMapping = {
      localId: "asset:xyz",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input).assetId).toBeUndefined();
  });

  it("rejects malformed mortgage localId (wrong segment count)", () => {
    const input: AccountMapping = {
      localId: "mortgage:1",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input).loanId).toBeUndefined();
  });

  it("rejects mortgage localId with invalid type segment", () => {
    const input: AccountMapping = {
      localId: "mortgage:1:bogus",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input).loanId).toBeUndefined();
  });

  it("rejects mortgage localId with non-numeric loan id", () => {
    const input: AccountMapping = {
      localId: "mortgage:abc:propertyValue",
      localName: "x",
      remoteAccountId: "r",
      syncDirection: "pull",
    };
    expect(mappingWithTypedIds(input).loanId).toBeUndefined();
  });
});

describe("mappingsWithTypedIds", () => {
  it("normalizes every entry in an array", () => {
    const input: AccountMapping[] = [
      {
        localId: "performance:1",
        localName: "A",
        remoteAccountId: "r1",
        syncDirection: "push",
      },
      {
        localId: "asset:2",
        localName: "B",
        remoteAccountId: "r2",
        syncDirection: "pull",
      },
    ];
    const result = mappingsWithTypedIds(input);
    expect(result[0]!.performanceAccountId).toBe(1);
    expect(result[1]!.assetId).toBe(2);
  });
});

describe("debt mappings", () => {
  const m = (
    localId: string,
    remoteAccountId: string,
    syncDirection: "pull" | "push" | "both" = "pull",
  ) => ({ localId, localName: localId, remoteAccountId, syncDirection });

  it("derives debtId from debt:{id}", () => {
    expect(mappingWithTypedIds(m("debt:7", "r1")).debtId).toBe(7);
    expect(mappingWithTypedIds(m("debt:x", "r1")).debtId).toBeUndefined();
  });

  it("debts, cash and credit card only pull", () => {
    expect(isPullOnlyLocalId("debt:7")).toBe(true);
    expect(isPullOnlyLocalId("cash")).toBe(true);
    expect(isPullOnlyLocalId("creditCard")).toBe(true);
    expect(isPullOnlyLocalId("asset:1")).toBe(false);
  });

  it("each target allows only its own directions", () => {
    expect(allowedDirectionsForLocalId("performance:3")).toEqual(["push"]);
    expect(allowedDirectionsForLocalId("debt:7")).toEqual(["pull"]);
    expect(allowedDirectionsForLocalId("cash")).toEqual(["pull"]);
    expect(allowedDirectionsForLocalId("asset:1")).toEqual([
      "pull",
      "push",
      "both",
    ]);
    // Legacy plain-name mapping: a real asset mapping, any direction.
    expect(allowedDirectionsForLocalId("Savings Bond")).toHaveLength(3);
    // The typed field counts even when the localId breadcrumb is missing.
    expect(
      allowedDirectionsForMapping({
        localName: "Roth IRA",
        remoteAccountId: "r1",
        syncDirection: "pull",
        performanceAccountId: 3,
      }),
    ).toEqual(["push"]);
  });

  it("a budget account pulled into two places is reported once; pushes don't count", () => {
    expect(
      remotesPulledTwice([
        m("creditCard", "r1"),
        m("debt:7", "r1", "both"),
        m("debt:8", "r1"),
        m("performance:1", "r2", "push"),
        m("performance:2", "r2", "push"),
        m("cash", "r3"),
      ]),
    ).toEqual(["r1"]);
  });

  it("a Ledgr row pulled from two budget accounts is reported once; Cash and Credit Card sum by design", () => {
    expect(
      localTargetsPulledTwice([
        m("debt:5", "r1"),
        m("debt:5", "r2", "both"),
        m("debt:5", "r3", "push"),
        m("mortgage:3:loanBalance", "r4"),
        m("mortgage:3:propertyValue", "r5"),
        m("asset:2", "r6"),
        m("cash", "r7"),
        m("cash", "r8"),
        m("creditCard", "r9"),
        m("creditCard", "r10"),
      ]),
    ).toEqual(["debt:5"]);
  });
});
