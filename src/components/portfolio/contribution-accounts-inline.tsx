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
      {label && <label className="block text-[10px] text-muted mb-0.5">{label}</label>}
      {disabled ? (
        <div className="border border-subtle bg-surface-sunken rounded px-2 py-1 text-xs text-muted">
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
          className="border rounded px-2 py-1 text-xs w-full"
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
      <label className="block text-[10px] text-muted mb-0.5">{label}</label>
      {disabled ? (
        <div className="border border-subtle bg-surface-sunken rounded px-2 py-1 text-xs text-muted">
          {options.find((o) => o.value === value)?.label ?? value}
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border rounded px-2 py-1 text-xs w-full"
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
