import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import type { ApiCategoryOption } from "./integrations-types";

/** Grouped select for API categories (group > category hierarchy) */
export function ApiCategorySelect({
  value,
  options,
  onChange,
  placeholder = "Select API category...",
}: {
  value: string;
  options: ApiCategoryOption[];
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const grouped = options.reduce<Record<string, ApiCategoryOption[]>>(
    (acc, c) => {
      (acc[c.groupName] ??= []).push(c);
      return acc;
    },
    {},
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-1.5 py-1 text-[11px] border border-strong rounded bg-surface-primary focus:ring-1 focus:ring-blue-500"
    >
      <option value="">{placeholder}</option>
      {Object.entries(grouped).map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.budgeted ? `(${formatCurrency(c.budgeted)}/mo)` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
