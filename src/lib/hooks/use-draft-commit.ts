"use client";

/**
 * useDraftCommit — the keyed-local-draft-string machinery behind every
 * commit-on-blur field in the app (Batch 14/Pass 38: this exact
 * `useState<Record<string, string>>` + setDraft/clearDraft shape was
 * independently reinvented 13+ times across 10+ directories).
 *
 * Only the raw draft-string plumbing is shared. Per-field validation and
 * the actual mutation call stay at the call site — they genuinely differ
 * field to field (e.g. an empty commit clears a nullable override on one
 * field but is a no-op on another), so a call site still writes its own
 * `commitX` function; it just no longer hand-rolls the state underneath it.
 *
 *   const { drafts, setDraft, clearDraft } = useDraftCommit();
 *
 *   const commitName = () => {
 *     const draft = drafts.name;
 *     if (draft === undefined) return;
 *     clearDraft("name");
 *     const trimmed = draft.trim();
 *     if (!trimmed || trimmed === profile.name) return;
 *     updateMutation.mutate({ id, name: trimmed });
 *   };
 *
 *   <input value={drafts.name ?? profile.name} onChange={(e) => setDraft("name", e.target.value)} onBlur={commitName} />
 */

import { useCallback, useState } from "react";

export interface UseDraftCommitReturn {
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
