"use client";

/**
 * useInlineNumberEdit — the "one active cell at a time" state machine
 * behind editable data-grid tables (Batch 24/Pass 38): a single
 * editingKey + editValue pair, click-to-start, Enter/blur-to-commit,
 * Escape-to-cancel. Generic over the key shape (e.g.
 * `{ type: "annual" | "account"; id: number; field: string }` in
 * performance/page.tsx) so callers keep their own "is this cell the one
 * being edited" comparison — deep-equality isn't assumed here.
 *
 *   const edit = useInlineNumberEdit<EditingCell>({
 *     onCommit: (key, value) => {
 *       if (key.type === "annual") updateAnnual.mutate({ id: key.id, [key.field]: value });
 *       else updateAccount.mutate({ id: key.id, [key.field]: value });
 *     },
 *   });
 *
 *   <EditableCell
 *     isEditing={edit.editingKey?.type === "annual" && edit.editingKey.id === row.id && edit.editingKey.field === "fees"}
 *     editValue={edit.editValue}
 *     onStartEdit={() => edit.startEdit({ type: "annual", id: row.id, field: "fees" }, row.fees)}
 *     onEditValueChange={edit.setEditValue}
 *     onSaveEdit={edit.commit}
 *     onKeyDown={edit.handleKeyDown}
 *   />
 */

import { useCallback, useState, type KeyboardEvent } from "react";

export interface UseInlineNumberEditReturn<TKey> {
  editingKey: TKey | null;
  editValue: string;
  setEditValue: (v: string) => void;
  /** Begin editing `key`, seeding the draft from `currentValue`. */
  startEdit: (key: TKey, currentValue: number | string) => void;
  /** Commit the current draft. A blank draft is a silent no-op cancel,
   *  matching every reinvented copy of this pattern. */
  commit: () => void;
  cancel: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

export function useInlineNumberEdit<TKey>({
  onCommit,
}: {
  onCommit: (key: TKey, value: string) => void;
}): UseInlineNumberEditReturn<TKey> {
  const [editingKey, setEditingKey] = useState<TKey | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = useCallback((key: TKey, currentValue: number | string) => {
    setEditingKey(key);
    setEditValue(String(currentValue));
  }, []);

  const cancel = useCallback(() => setEditingKey(null), []);

  const commit = useCallback(() => {
    if (editingKey === null) return;
    const value = editValue.trim();
    if (value === "") {
      setEditingKey(null);
      return;
    }
    onCommit(editingKey, value);
    setEditingKey(null);
  }, [editingKey, editValue, onCommit]);

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
