"use client";

/**
 * One-active-cell edit state for editable grids: click to start, Enter/blur to
 * commit, Escape to cancel. Generic over the key; callers compare keys themselves.
 */

import { useCallback, useRef, useState, type KeyboardEvent } from "react";

interface UseInlineNumberEditReturn<TKey> {
  editingKey: TKey | null;
  editValue: string;
  setEditValue: (v: string) => void;
  /** Begin editing `key`, seeding the draft from `currentValue`. */
  startEdit: (key: TKey, currentValue: number | string) => void;
  /** Commit the current draft. A blank draft cancels silently unless
   *  `allowBlankCommit` is set, in which case onCommit gets `""`. */
  commit: () => void;
  cancel: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

export function useInlineNumberEdit<TKey>({
  onCommit,
  allowBlankCommit = false,
}: {
  onCommit: (key: TKey, value: string) => void;
  allowBlankCommit?: boolean;
}): UseInlineNumberEditReturn<TKey> {
  const [editingKey, setEditingKey] = useState<TKey | null>(null);
  const [editValue, setEditValue] = useState("");
  // An edit ends once, by commit or cancel: a blur after Enter or Escape
  // reaches the same render's handlers and must not commit; startEdit
  // begins a new edit.
  const committed = useRef(false);

  const startEdit = useCallback((key: TKey, currentValue: number | string) => {
    committed.current = false;
    setEditingKey(key);
    setEditValue(String(currentValue));
  }, []);

  const cancel = useCallback(() => {
    committed.current = true;
    setEditingKey(null);
  }, []);

  const commit = useCallback(() => {
    if (editingKey === null || committed.current) return;
    committed.current = true;
    const value = editValue.trim();
    if (value === "" && !allowBlankCommit) {
      setEditingKey(null);
      return;
    }
    onCommit(editingKey, value);
    setEditingKey(null);
  }, [editingKey, editValue, onCommit, allowBlankCommit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel],
  );

  return {
    editingKey,
    editValue,
    setEditValue,
    startEdit,
    commit,
    cancel,
    handleKeyDown,
  };
}
