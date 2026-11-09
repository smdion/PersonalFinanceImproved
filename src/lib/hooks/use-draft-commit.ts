"use client";

/**
 * Keyed local draft strings for commit-on-blur fields. Validation and the
 * mutation stay at the call site: read `drafts.x ?? saved`, setDraft on change,
 * and on blur clearDraft then commit.
 */

import { useCallback, useState } from "react";

interface UseDraftCommitReturn {
  /** Raw in-progress text per key. Read directly (`drafts.foo ?? fallback`)
   *  for display, same as the hand-rolled state it replaces. */
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  /** Clears a key's draft once its commit has fired (success or no-op). */
  clearDraft: (key: string) => void;
}

export function useDraftCommit(): UseDraftCommitReturn {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const setDraft = useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearDraft = useCallback((key: string) => {
    setDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return { drafts, setDraft, clearDraft };
}
