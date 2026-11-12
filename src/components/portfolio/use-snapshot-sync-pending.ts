"use client";

/**
 * Tracks "latest-snapshot balances edited but not pushed to YNAB/Actual" in localStorage, so a
 * banner can nag on any Portfolio visit in this browser. Other browsers won't see it; the
 * snapshot row's manual "Resync" button is the backstop.
 */
import { useCallback, useEffect, useState } from "react";
import { isRecord, readBrowserJson } from "@/lib/hooks/browser-storage";

const KEY = "pf-snapshot-unsynced";

type SnapshotSyncPending = {
  snapshotId: number;
  snapshotDate: string;
  count: number;
  editedAt: number;
};

const isPending = (v: unknown): v is SnapshotSyncPending =>
  isRecord(v) &&
  typeof v.snapshotId === "number" &&
  typeof v.snapshotDate === "string" &&
  typeof v.count === "number" &&
  typeof v.editedAt === "number";

function read(): SnapshotSyncPending | null {
  return readBrowserJson(KEY, isPending) ?? null;
}

function write(p: SnapshotSyncPending | null): void {
  try {
    if (p) window.localStorage.setItem(KEY, JSON.stringify(p));
    else window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("pf-snapshot-unsynced-change"));
  } catch {
    /* private mode / quota — a missed banner is acceptable */
  }
}

export function useSnapshotSyncPending() {
  const [pending, setPending] = useState<SnapshotSyncPending | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external (localStorage) state to local state on mount
    setPending(read());
    const onChange = () => setPending(read());
    window.addEventListener("pf-snapshot-unsynced-change", onChange);
    window.addEventListener("storage", onChange); // other tab
    return () => {
      window.removeEventListener("pf-snapshot-unsynced-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const markDirty = useCallback((snapshotId: number, snapshotDate: string) => {
    const prev = read();
    write({
      snapshotId,
      snapshotDate,
      count: prev?.snapshotId === snapshotId ? prev.count + 1 : 1,
      editedAt: Date.now(),
    });
  }, []);

  const clear = useCallback(() => write(null), []);

  return { pending, markDirty, clear, peek: read };
}
