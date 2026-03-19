"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

type ConfirmState = {
  mode: "confirm";
  message: string;
  resolve: (value: boolean) => void;
};

type PromptState = {
  mode: "prompt";
  message: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
};

type DialogState = ConfirmState | PromptState | null;

let globalSetState: ((state: DialogState) => void) | null = null;

// ---------------------------------------------------------------------------
// Imperative APIs
// ---------------------------------------------------------------------------

/**
 * Imperative confirm API — drop-in replacement for window.confirm().
 * Returns a Promise<boolean> that resolves when the user clicks Confirm or Cancel.
 */
export function confirm(message: string): Promise<boolean> {
  if (!globalSetState)
    throw new Error(
      "ConfirmDialog not mounted — ensure <ConfirmDialog /> is in the app shell.",
    );
  return new Promise((resolve) => {
    globalSetState!({ mode: "confirm", message, resolve });
  });
}

/**
 * Imperative prompt API — drop-in replacement for window.prompt().
 * Returns a Promise<string | null> (null if cancelled).
 */
export function promptText(
  message: string,
  placeholder?: string,
): Promise<string | null> {
  if (!globalSetState)
    throw new Error(
      "ConfirmDialog not mounted — ensure <ConfirmDialog /> is in the app shell.",
    );
  return new Promise((resolve) => {
    globalSetState!({ mode: "prompt", message, placeholder, resolve });
  });
}

// ---------------------------------------------------------------------------
// Dialog component — mount once in app shell
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const [state, setState] = useState<DialogState>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Register global setter
  useEffect(() => {
    globalSetState = setState;
    return () => {
      globalSetState = null;
    };
  }, []);

  // Focus on open
  useEffect(() => {
    if (!state) return;
    if (state.mode === "prompt") {
      // Small delay to let the input render
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      actionRef.current?.focus();
    }
  }, [state]);

  // Escape key
  useEffect(() => {
    if (!state) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  const handleCancel = useCallback(() => {
    if (!state) return;
    if (state.mode === "confirm") state.resolve(false);
    else state.resolve(null);
    setState(null);
  }, [state]);

  const handleConfirm = useCallback(() => {
    if (!state) return;
    if (state.mode === "confirm") {
      state.resolve(true);
    } else {
      const val = inputRef.current?.value.trim() ?? "";
      state.resolve(val || null);
    }
    setState(null);
  }, [state]);

  if (!state) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === backdropRef.current) handleCancel();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        className="bg-surface-primary rounded-lg shadow-xl border p-5 max-w-sm w-full mx-4"
      >
        <p id="confirm-dialog-message" className="text-sm text-secondary mb-4">
          {state.message}
        </p>

        {state.mode === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            placeholder={state.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
            className="w-full mb-4 px-3 py-2 text-sm border border-strong rounded-md bg-surface-primary text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm text-muted hover:bg-surface-elevated rounded transition-colors"
          >
            Cancel
          </button>
          <button
            ref={actionRef}
            onClick={handleConfirm}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              state.mode === "confirm"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {state.mode === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
