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
        className="cursor-pointer rounded transition-all hover:ring-2 hover:ring-blue-300"
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
      className="text-caption bg-surface-primary rounded border border-blue-400 px-1 py-0.5 font-semibold tracking-wide uppercase"
    >
      {WATERFALL_CATEGORIES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
