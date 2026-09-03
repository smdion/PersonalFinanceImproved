"use client";

/**
 * useBudgetPageState — extracted from budget-content.tsx.
 *
 * Owns: edit mode, draft store, column resize state, lazy-rendering
 * visible-count, IntersectionObserver lifecycle, selectedColumnRef, and
 * the beforeunload guard.
 */

import {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type RefObject,
} from "react";
import type { RawItem } from "@/components/budget";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EDIT_LOCK_KEYS } from "@/components/ui/edit-lock-toggle";

const INITIAL_VISIBLE = 15;
const LOAD_MORE_COUNT = 10;

type ProfileResolutionTiers = {
  planPinId: number | null;
  localSelectionId: number | null;
  globalDefaultId: number | null;
};

type UpdateBatch = {
  mutateAsync: (args: {
    updates: Array<{ id: number; colIndex: number; amount: number }>;
    contributionProfile?: ProfileResolutionTiers;
  }) => Promise<unknown>;
};

export function useBudgetPageState({
  data,
  nameColWidth,
  setNameColWidth,
  updateBatch,
  contributionProfileTiers,
}: {
  data: object | null | undefined;
  nameColWidth: number;
  setNameColWidth: (w: number) => void;
  updateBatch: UpdateBatch;
  /** Which Contribution Profile a linked item's edit should land in — same
   *  tiers object computeActiveSummary already resolves with. */
  contributionProfileTiers: ProfileResolutionTiers;
}) {
  // ---- Edit mode + draft store ----

  // Locked (read-only) is the default, persisted per-browser like every other
  // padlock in the app. Stored as "locked" — editMode is its inverse. Shares
  // EDIT_LOCK_KEYS.profileEditLocked with the Salary/Contribution/Savings tabs —
  // one padlock for the whole Budget page, not four independent ones that
  // could drift out of sync.
  const [budgetLocked, setBudgetLocked] = useLocalStorage<boolean>(
    EDIT_LOCK_KEYS.profileEditLocked,
    true,
  );
  const editMode = !budgetLocked;
  const setEditMode = useCallback(
    (next: boolean) => setBudgetLocked(!next),
    [setBudgetLocked],
  );
  const [editDrafts, setEditDrafts] = useState<Map<string, number>>(new Map());

  const setDraft = useCallback(
    (id: number, colIndex: number, amount: number) => {
      setEditDrafts((prev) => {
        const next = new Map(prev);
        next.set(`${id}:${colIndex}`, amount);
        return next;
      });
    },
    [],
  );

  const getDraft = useCallback(
    (id: number, colIndex: number, original: number): number => {
      return editDrafts.get(`${id}:${colIndex}`) ?? original;
    },
    [editDrafts],
  );

  // Stable refs so saveAllDrafts never closes over stale values
  const editDraftsRef = useRef(editDrafts);
  const updateBatchRef = useRef(updateBatch);
  const contributionProfileTiersRef = useRef(contributionProfileTiers);
  useEffect(() => {
    editDraftsRef.current = editDrafts;
    updateBatchRef.current = updateBatch;
    contributionProfileTiersRef.current = contributionProfileTiers;
  }, [editDrafts, updateBatch, contributionProfileTiers]);

  const saveAllDrafts = async () => {
    const drafts = editDraftsRef.current;
    if (drafts.size === 0) {
      setEditMode(false);
      return;
    }
    const updates = Array.from(drafts.entries()).map(([key, amount]) => {
      const [idStr, colStr] = key.split(":");
      return {
        id: parseInt(idStr!, 10),
        colIndex: parseInt(colStr!, 10),
        amount,
      };
    });
    await updateBatchRef.current.mutateAsync({
      updates,
      contributionProfile: contributionProfileTiersRef.current,
    });
    setEditDrafts(new Map());
    setEditMode(false);
  };

  const toggleEditMode = () => {
    if (editMode) {
      saveAllDrafts().catch(console.warn);
    } else {
      setEditDrafts(new Map());
      setEditMode(true);
    }
  };

  // Warn before navigating away with unsaved draft edits
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    if (editDrafts.size > 0) {
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [editDrafts.size]);

  // ---- Column resize ----

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const effectiveNameColWidth = dragWidth ?? nameColWidth;
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = nameColWidth;
      resizeRef.current = { startX, startW };
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setDragWidth(Math.max(120, Math.min(400, startW + delta)));
      };
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const finalWidth = Math.max(
          120,
          Math.min(400, startW + (ev.clientX - startX)),
        );
        setDragWidth(null);
        setNameColWidth(finalWidth);
        resizeRef.current = null;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [nameColWidth, setNameColWidth],
  );

  // ---- Lazy-rendering visible count + IntersectionObserver ----

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const prevCatLenRef = useRef(0);

  // Pre-compute category count from raw data for the observer below
  const categoryCount = useMemo(() => {
    if (!data || !("rawItems" in data) || !data.rawItems) return 0;
    const items = data.rawItems as RawItem[];
    const seen = new Set<string>();
    for (const item of items) seen.add(item.category);
    return seen.size;
  }, [data]);

  // Reset visible count when categories change (e.g. profile switch)
  useEffect(() => {
    if (categoryCount !== prevCatLenRef.current) {
      prevCatLenRef.current = categoryCount;
      setVisibleCount(INITIAL_VISIBLE);
    }
  }, [categoryCount]);

  // Expand visible count as user scrolls past the sentinel row
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(prev + LOAD_MORE_COUNT, categoryCount),
          );
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [categoryCount, visibleCount]);

  return {
    editMode,
    setEditMode,
    editDrafts,
    getDraft,
    setDraft,
    toggleEditMode,
    sentinelRef: sentinelRef as RefObject<HTMLTableRowElement | null>,
    visibleCount,
    effectiveNameColWidth,
    onResizeStart,
  };
}
