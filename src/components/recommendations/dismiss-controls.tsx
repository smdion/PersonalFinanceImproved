"use client";

/** Snooze / Dismiss with an optional "why" note — admins only. */
import { useState } from "react";

const NOTE_MAX = 280;

export function DismissControls({
  disabled,
  onSnooze,
  onDismiss,
}: {
  disabled: boolean;
  onSnooze: (note: string) => void;
  onDismiss: (note: string) => void;
}) {
  const [mode, setMode] = useState<"snooze" | "dismiss" | null>(null);
  const [note, setNote] = useState("");
  if (mode === null)
    return (
      <span className="text-caption flex gap-1.5 whitespace-nowrap">
        <button
          type="button"
          className="text-muted hover:text-primary"
          disabled={disabled}
          onClick={() => setMode("snooze")}
          title="Hide for 3 months"
        >
          Snooze
        </button>
        <button
          type="button"
          className="text-muted hover:text-primary"
          disabled={disabled}
          onClick={() => setMode("dismiss")}
          title="Hide unless it becomes urgent"
        >
          Dismiss
        </button>
      </span>
    );
  const confirm = () => {
    (mode === "snooze" ? onSnooze : onDismiss)(note);
    setMode(null);
    setNote("");
  };
  return (
    <form
      className="text-caption flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        confirm();
      }}
    >
      <input
        autoFocus
        value={note}
        maxLength={NOTE_MAX}
        placeholder="Why? (optional)"
        aria-label={mode === "snooze" ? "Why snooze" : "Why dismiss"}
        className="bg-surface-primary w-48 rounded border px-1.5 py-0.5"
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded bg-blue-600 px-2 py-0.5 text-white disabled:opacity-50"
      >
        {mode === "snooze" ? "Snooze" : "Dismiss"}
      </button>
      <button
        type="button"
        className="text-muted"
        onClick={() => {
          setMode(null);
          setNote("");
        }}
      >
        Cancel
      </button>
    </form>
  );
}
