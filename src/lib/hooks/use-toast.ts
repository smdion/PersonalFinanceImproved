"use client";

import { useSyncExternalStore, useCallback } from "react";

export type ToastVariant = "success" | "error" | "info" | "loading";

/**
 * Optional action button on a toast.
 * Used for "Undo" affordances after destructive operations + as a
 * general action escape hatch.
 */
export interface ToastAction {
  /** Button label (e.g., "Undo"). */
  label: string;
  /** Called when the user clicks the action. The toast auto-dismisses. */
  onClick: () => void;
}

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Optional action button (e.g., undo). */
  action?: ToastAction;
};

type Listener = () => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit() {
  listeners.forEach((l) => l());
}

function getSnapshot(): Toast[] {
  return toasts;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function addToast(
  message: string,
  variant: ToastVariant = "info",
  duration = 4000,
  action?: ToastAction,
): string {
  const id = `toast-${++counter}`;
  toasts = [...toasts, { id, message, variant, action }];
  emit();
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
  return id;
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Imperative toast API — call from anywhere (components, mutation callbacks, etc.).
 *
 * Usage:
 *   toast('Something happened');
 *   toast.success('Saved');
 *   toast.error('Failed to save');
 */
export function toast(
  message: string,
  variant: ToastVariant = "info",
  duration = 4000,
  action?: ToastAction,
): string {
  return addToast(message, variant, duration, action);
}

toast.success = (message: string, duration?: number, action?: ToastAction) =>
  addToast(message, "success", duration, action);
toast.error = (message: string, duration?: number, action?: ToastAction) =>
  addToast(message, "error", duration ?? 6000, action);
toast.info = (message: string, duration?: number, action?: ToastAction) =>
  addToast(message, "info", duration, action);
/**
 * A persistent status toast (duration: 0 — the existing "don't
 * auto-dismiss" convention) for an in-progress operation. Caller is
 * responsible for dismissing it (via useToasts().dismiss(id)) once the
 * operation settles.
 */
toast.loading = (message: string) => addToast(message, "loading", 0);

/**
 * Convenience: show a "Done — Undo" toast for 5 seconds. Used by
 * useOptimisticMutation and any other mutation site that wants to
 * give the user a brief window to undo a destructive action.
 */
toast.undo = (message: string, undoFn: () => void, duration = 5000) =>
  addToast(message, "info", duration, { label: "Undo", onClick: undoFn });

/**
 * React hook to read the current toast list. Used by ToastContainer only.
 */
export function useToasts(): {
  toasts: Toast[];
  dismiss: (id: string) => void;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const dismiss = useCallback((id: string) => removeToast(id), []);
  return { toasts: current, dismiss };
}
