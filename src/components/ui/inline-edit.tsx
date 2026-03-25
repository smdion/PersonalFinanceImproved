"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

type InlineEditProps = {
  value: string;
  onSave: (newValue: string) => void;
  /** Format for display (when not editing). Defaults to identity. */
  formatDisplay?: (value: string) => string;
  /** Parse input before saving (e.g., strip $ and commas). */
  parseInput?: (raw: string) => string;
  /** Input type. Default: 'text' */
  type?: "text" | "number";
  /** CSS class for the display span */
  className?: string;
  /** Whether editing is allowed. Default: true */
  editable?: boolean;
};

/**
 * Inline edit component — click to edit, Enter/blur to save, Escape to cancel.
 * Used on display pages to allow quick value changes without navigating to settings.
 */
export function InlineEdit({
  value,
  onSave,
  formatDisplay,
  parseInput,
  type = "text",
  className = "",
  editable = true,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external value changes to draft state
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external data to local state
      setDraft(value);
    }
  }, [value, editing]);

  const save = () => {
    const parsed = parseInput ? parseInput(draft) : draft;
    if (parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (!editable) {
    const display = formatDisplay ? formatDisplay(value) : value;
    return <span className={className}>{display}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={`border border-blue-400 rounded px-1.5 py-0.5 text-sm bg-surface-primary focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 w-full max-w-[120px] ${className}`}
      />
    );
  }

  const display = formatDisplay ? formatDisplay(value) : value;
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`group inline-flex items-center gap-1 cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 transition-colors ${className}`}
      title="Click to edit"
    >
      <span>{display}</span>
      <svg
        className="w-3 h-3 text-faint group-hover:text-blue-400 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
        />
      </svg>
    </button>
  );
}

type InlineSelectProps = {
  value: string;
  options: { label: string; value: string }[];
  onSave: (newValue: string) => void;
  className?: string;
  editable?: boolean;
};

/**
 * Inline select — click to open dropdown, pick to save.
 */
export function InlineSelect({
  value,
  options,
  onSave,
  className = "",
  editable = true,
}: InlineSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
    }
  }, [editing]);

  if (!editable) {
    const label = options.find((o) => o.value === value)?.label ?? value;
    return <span className={className}>{label}</span>;
  }

  if (editing) {
    return (
      <select
        ref={selectRef}
        value={value}
        onChange={(e) => {
          onSave(e.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={`border border-blue-400 rounded px-1.5 py-0.5 text-sm bg-surface-primary focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${className}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group inline-flex items-center gap-1 cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 transition-colors ${className}`}
      title="Click to change"
    >
      <span>{label}</span>
      <svg
        className="w-3 h-3 text-faint group-hover:text-blue-400 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}
