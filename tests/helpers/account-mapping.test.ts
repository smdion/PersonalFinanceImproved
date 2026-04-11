import { describe, it, expect } from "vitest";
import {
  mappingWithTypedIds,
  mappingsWithTypedIds,
} from "@/lib/utils/account-mapping";
import type { AccountMapping } from "@/lib/db/schema";

describe("mappingWithTypedIds", () => {
  it("populates performanceAccountId from legacy localId", () => {
    const input: AccountMapping = {
      localId: "performance:42",
      localName: "Sean 401k",
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
