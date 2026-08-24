"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

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
  /** Pre-filled, editable starting value (distinct from `placeholder`,
   *  which is only hint text and isn't submitted on an empty Enter). */
  defaultValue?: string;
  resolve: (value: string | null) => void;
};

/** Name + optional "base this off of" select in one dialog — used for
 *  creating a budget profile linked to a Contribution Profile at creation
 *  time, instead of a name-only prompt followed by a separate step. */
type PromptWithSelectState = {
  mode: "promptWithSelect";
  message: string;
  placeholder?: string;
  selectLabel: string;
  selectOptions: { value: string; label: string }[];
  /** First entry's value, or "" for "none" — shown pre-selected. */
  defaultSelectValue?: string;
  resolve: (value: { text: string; selectValue: string | null } | null) => void;
};

/** Confirm gated on a bulleted list of changes (e.g. "here's what will
 *  change if you proceed") — same amber-warning visual language as the
 *  What-If tab's `overriddenColumns` banner, in dialog form. */
type ConfirmDiffState = {
  mode: "confirmDiff";
  message: string;
  lines: string[];
  confirmLabel?: string;
  resolve: (value: boolean) => void;
};

type DialogState =
  ConfirmState | PromptState | PromptWithSelectState | ConfirmDiffState | null;

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
 * Imperative confirm API for a change list — e.g. "switching profiles will
 * change these accounts" — rendered as an amber bulleted list rather than
 * `confirm()`'s single-paragraph message, which has no line-wrap handling
 * for multi-item content. Returns a Promise<boolean> exactly like confirm().
 */
export function confirmWithDiff(
  message: string,
  lines: string[],
  confirmLabel?: string,
): Promise<boolean> {
  if (!globalSetState)
    throw new Error(
      "ConfirmDialog not mounted — ensure <ConfirmDialog /> is in the app shell.",
    );
  return new Promise((resolve) => {
    globalSetState!({
      mode: "confirmDiff",
      message,
      lines,
      confirmLabel,
      resolve,
    });
  });
}

/**
 * Imperative prompt API — drop-in replacement for window.prompt().
 * Returns a Promise<string | null> (null if cancelled).
 */
export function promptText(
  message: string,
  placeholder?: string,
  defaultValue?: string,
): Promise<string | null> {
  if (!globalSetState)
    throw new Error(
      "ConfirmDialog not mounted — ensure <ConfirmDialog /> is in the app shell.",
    );
  return new Promise((resolve) => {
    globalSetState!({
      mode: "prompt",
      message,
      placeholder,
      defaultValue,
      resolve,
    });
  });
}

/**
 * Imperative name + select prompt — e.g. "New budget profile name" plus
 * "base it off of this Contribution Profile." Returns null if cancelled;
 * `selectValue` is null when "none" is chosen (an empty first option).
 */
export function promptTextWithSelect(
  message: string,
  placeholder: string,
  selectLabel: string,
  selectOptions: { value: string; label: string }[],
  defaultSelectValue?: string,
): Promise<{ text: string; selectValue: string | null } | null> {
  if (!globalSetState)
    throw new Error(
      "ConfirmDialog not mounted — ensure <ConfirmDialog /> is in the app shell.",
    );
  return new Promise((resolve) => {
    globalSetState!({
      mode: "promptWithSelect",
      message,
      placeholder,
      selectLabel,
      selectOptions,
      defaultSelectValue,
      resolve,
    });
  });
}

// ---------------------------------------------------------------------------
// Dialog component — mount once in app shell
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const [state, setState] = useState<DialogState>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(state !== null);

  // Register global setter
  useEffect(() => {
    globalSetState = setState;
    return () => {
      globalSetState = null;
    };
  }, []);

  const handleCancel = useCallback(() => {
    if (!state) return;
    if (state.mode === "confirm" || state.mode === "confirmDiff")
      state.resolve(false);
    else state.resolve(null);
    setState(null);
  }, [state]);

  const handleConfirm = useCallback(() => {
    if (!state) return;
    if (state.mode === "confirm" || state.mode === "confirmDiff") {
      state.resolve(true);
    } else if (state.mode === "promptWithSelect") {
      const text = inputRef.current?.value.trim() ?? "";
      if (!text) {
        setState(null);
        state.resolve(null);
        return;
      }
      const selectValue = selectRef.current?.value || null;
      state.resolve({ text, selectValue });
    } else {
      const val = inputRef.current?.value.trim() ?? "";
      state.resolve(val || null);
    }
    setState(null);
  }, [state]);

  // Focus on open
  useEffect(() => {
    if (!state) return;
    if (state.mode === "prompt" || state.mode === "promptWithSelect") {
      // Small delay to let the input render
      requestAnimationFrame(() => inputRef.current?.select());
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
  }, [state, handleCancel]);

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
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        className={`bg-surface-primary rounded-lg shadow-xl border p-5 w-full mx-4 ${
          state.mode === "confirmDiff" ? "max-w-md" : "max-w-sm"
        }`}
      >
        <p id="confirm-dialog-message" className="text-sm text-secondary mb-4">
          {state.message}
        </p>

        {state.mode === "confirmDiff" && (
          <div className="text-caption text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 max-h-64 overflow-y-auto">
            <ul className="list-disc list-inside space-y-0.5">
              {state.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {state.mode === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            defaultValue={state.defaultValue}
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

        {state.mode === "promptWithSelect" && (
          <div className="space-y-3 mb-4">
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
              className="w-full px-3 py-2 text-sm border border-strong rounded-md bg-surface-primary text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div>
              <label className="block text-caption text-muted mb-1">
                {state.selectLabel}
              </label>
              <select
                ref={selectRef}
                defaultValue={state.defaultSelectValue ?? ""}
                className="w-full px-3 py-2 text-sm border border-strong rounded-md bg-surface-primary text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">None</option>
                {state.selectOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
                : state.mode === "confirmDiff"
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {state.mode === "confirm"
              ? "Confirm"
              : state.mode === "confirmDiff"
                ? (state.confirmLabel ?? "Switch anyway")
                : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
