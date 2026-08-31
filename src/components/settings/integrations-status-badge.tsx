/** Renders a colored status badge (linked, suggested, unmatched, or orphaned) for budget/savings integration match rows. */
import React from "react";
import { STATUS_STYLES } from "./integrations-types";

export function StatusBadge({
  status,
}: {
  status: "linked" | "suggested" | "unmatched" | "orphaned";
}) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`text-caption px-1.5 py-0.5 rounded whitespace-nowrap ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}
