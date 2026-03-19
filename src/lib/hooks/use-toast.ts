"use client";

import { useSyncExternalStore, useCallback } from "react";

export type ToastVariant = "success" | "error" | "info";

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
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
) {
  const id = `toast-${++counter}`;
  toasts = [...toasts, { id, message, variant }];
  emit();
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
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
) {
  addToast(message, variant, duration);
}

toast.success = (message: string, duration?: number) =>
  addToast(message, "success", duration);
toast.error = (message: string, duration?: number) =>
  addToast(message, "error", duration ?? 6000);
toast.info = (message: string, duration?: number) =>
  addToast(message, "info", duration);

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
