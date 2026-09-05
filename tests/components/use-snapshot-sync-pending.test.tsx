/**
 * useSnapshotSyncPending — the localStorage "balances edited but not
 * pushed to YNAB/Actual" flag (no schema, survives a tab close).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSnapshotSyncPending } from "@/components/portfolio/hooks/use-snapshot-sync-pending";

const KEY = "pf-snapshot-unsynced";

beforeEach(() => window.localStorage.clear());

describe("useSnapshotSyncPending", () => {
  it("marks a snapshot dirty, counts repeats, and clears", () => {
    const { result } = renderHook(() => useSnapshotSyncPending());
    expect(result.current.pending).toBeNull();

    act(() => result.current.markDirty(42, "2026-09-05"));
    expect(result.current.pending).toMatchObject({
      snapshotId: 42,
      snapshotDate: "2026-09-05",
      count: 1,
    });

    act(() => result.current.markDirty(42, "2026-09-05"));
    expect(result.current.pending?.count).toBe(2);

    act(() => result.current.clear());
    expect(result.current.pending).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("resets the count when a different snapshot is edited", () => {
    const { result } = renderHook(() => useSnapshotSyncPending());
    act(() => result.current.markDirty(1, "2026-01-01"));
    act(() => result.current.markDirty(1, "2026-01-01"));
    act(() => result.current.markDirty(2, "2026-02-01"));
    expect(result.current.pending).toMatchObject({ snapshotId: 2, count: 1 });
  });

  it("hydrates from an existing localStorage value on mount", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        snapshotId: 9,
        snapshotDate: "2026-03-03",
        count: 4,
        editedAt: Date.now(),
      }),
    );
    const { result } = renderHook(() => useSnapshotSyncPending());
    expect(result.current.pending).toMatchObject({ snapshotId: 9, count: 4 });
  });
});
