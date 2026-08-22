import "../helpers/setup-mocks";
import { describe, it, expect } from "vitest";
import { resolveAccountBalance } from "@/server/helpers/api-balance-resolution";
import type { AccountMapping } from "@/lib/db/schema";

function makeMapping(overrides: Partial<AccountMapping> = {}): AccountMapping {
  return {
    id: "map-1",
    performanceAccountId: "perf-1",
    remoteAccountId: "remote-1",
    syncDirection: "pull",
    ...overrides,
  } as AccountMapping;
}

describe("resolveAccountBalance", () => {
  it("falls back to snapshot balance when no mapping exists", () => {
    const result = resolveAccountBalance(
      1000,
      undefined,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 1000, source: "snapshot" });
  });

  it("falls back to snapshot balance when syncDirection is neither pull nor both", () => {
    const mapping = makeMapping({ syncDirection: "push" });
    const result = resolveAccountBalance(
      1000,
      mapping,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 1000, source: "snapshot" });
  });

  it("falls back to snapshot balance when apiBalanceMap is null", () => {
    const mapping = makeMapping();
    const result = resolveAccountBalance(1000, mapping, null);
    expect(result).toEqual({ balance: 1000, source: "snapshot" });
  });

  it("falls back to snapshot balance when the remote id is absent from the map", () => {
    const mapping = makeMapping({ remoteAccountId: "remote-missing" });
    const result = resolveAccountBalance(
      1000,
      mapping,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 1000, source: "snapshot" });
  });

  it("uses API balance when mapping is pull-direction and the remote id is present", () => {
    const mapping = makeMapping({ syncDirection: "pull" });
    const result = resolveAccountBalance(
      1000,
      mapping,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 2000, source: "api" });
  });

  it("uses API balance when mapping is both-direction and the remote id is present", () => {
    const mapping = makeMapping({ syncDirection: "both" });
    const result = resolveAccountBalance(
      1000,
      mapping,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 2000, source: "api" });
  });

  it("falls back to snapshot balance when mapping.performanceAccountId is null", () => {
    const mapping = makeMapping({ performanceAccountId: null });
    const result = resolveAccountBalance(
      1000,
      mapping,
      new Map([["remote-1", 2000]]),
    );
    expect(result).toEqual({ balance: 1000, source: "snapshot" });
  });
});
