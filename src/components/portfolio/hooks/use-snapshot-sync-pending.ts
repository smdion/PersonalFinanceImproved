"use client";

/**
 * Tracks "balances on the latest snapshot were edited but not yet pushed
 * to YNAB/Actual" in localStorage, so the state survives a tab close and
 * a persistent banner can nag on any Portfolio visit in this browser.
 *
 * No schema — matches the Feature-B draft decision. Blind spot: a hard
 * close plus never returning in this browser while the other user never
 * opens Portfolio. The snapshot row's manual "Resync" button is the
 * always-there backstop for that.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "pf-snapshot-unsynced";

export type SnapshotSyncPending = {
  snapshotId: number;
  snapshotDate: string;
  count: number;
  editedAt: number;
};

function read(): SnapshotSyncPending | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SnapshotSyncPending;
    return typeof p?.snapshotId === "number" ? p : null;
  } catch {
    return null;
  }
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
