/** Reusable inline-edit primitives (text input and select) used by contribution-account detail forms. */

import React from "react";

export function InlineText({
  label,
  value,
  placeholder,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && (
        <label className="text-caption text-muted mb-0.5 block">{label}</label>
      )}
      {disabled ? (
        <div className="border-subtle bg-surface-sunken text-muted rounded border px-2 py-1 text-xs">
          {value || placeholder || "—"}
        </div>
      ) : (
        <input
          type="text"
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (val !== value) onSave(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-full rounded border px-2 py-1 text-xs"
        />
      )}
    </div>
  );
}

export function InlineSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-caption text-muted mb-0.5 block">{label}</label>
      {disabled ? (
        <div className="border-subtle bg-surface-sunken text-muted rounded border px-2 py-1 text-xs">
          {options.find((o) => o.value === value)?.label ?? value}
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-2 py-1 text-xs"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
