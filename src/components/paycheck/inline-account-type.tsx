"use client";

import { useState } from "react";
import { AccountBadge } from "@/components/ui/account-badge";
import { WATERFALL_CATEGORIES } from "./types";
import type { AccountCategory } from "./types";

export function InlineAccountType({
  value,
  onSave,
}: {
  value: AccountCategory;
  onSave: (v: AccountCategory) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="cursor-pointer hover:ring-2 hover:ring-blue-300 rounded transition-all"
        title="Click to change account type"
      >
        <AccountBadge type={value} />
      </button>
    );
  }

  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => {
        onSave(e.target.value as AccountCategory);
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      className="text-[10px] font-semibold uppercase tracking-wide rounded border border-blue-400 px-1 py-0.5 bg-surface-primary"
    >
      {WATERFALL_CATEGORIES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
