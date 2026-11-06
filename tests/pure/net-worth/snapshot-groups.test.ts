import { describe, it, expect } from "vitest";
import { groupSnapshotAccounts } from "@/lib/pure/net-worth/snapshot-groups";

// ---------------------------------------------------------------------------
// groupSnapshotAccounts (pure)
// ---------------------------------------------------------------------------

describe("groupSnapshotAccounts", () => {
  it("returns empty map for empty array", () => {
    const result = groupSnapshotAccounts([]);
    expect(result.size).toBe(0);
  });

  it("groups accounts by snapshotId", () => {
    const accounts = [
      { snapshotId: 1, name: "A" },
      { snapshotId: 1, name: "B" },
      { snapshotId: 2, name: "C" },
      { snapshotId: 3, name: "D" },
      { snapshotId: 2, name: "E" },
    ];
    const result = groupSnapshotAccounts(accounts);
    expect(result.size).toBe(3);
    expect(result.get(1)).toHaveLength(2);
    expect(result.get(2)).toHaveLength(2);
    expect(result.get(3)).toHaveLength(1);
  });

  it("preserves account objects by reference", () => {
    const a = { snapshotId: 1, extra: "data" };
    const result = groupSnapshotAccounts([a]);
    expect(result.get(1)![0]).toBe(a);
  });

  it("handles single snapshot ID", () => {
    const accounts = [{ snapshotId: 5 }, { snapshotId: 5 }, { snapshotId: 5 }];
    const result = groupSnapshotAccounts(accounts);
    expect(result.size).toBe(1);
    expect(result.get(5)).toHaveLength(3);
  });
});
