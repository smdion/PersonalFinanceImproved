"use client";

import type { ReactNode } from "react";

/** Which way a table is sorted by one column, as `aria-sort` names it. */
export type SortDirection = "ascending" | "descending" | "none";

const ARROW: Record<SortDirection, string> = {
  ascending: " ↑",
  descending: " ↓",
  none: " ↕",
};

/**
 * A sorting column header: the cell holds `aria-sort` and the click; the
 * label's button has no handler, so its click (or Enter/Space) bubbles up.
 */
export function SortableHeader({
  sort,
  onSort,
  className,
  children,
}: {
  sort: SortDirection;
  onSort: () => void;
  /** The header cell's classes. */
  className: string;
  /** The column's name; the arrow for `sort` follows it. */
  children: ReactNode;
}) {
  return (
    <th className={className} aria-sort={sort} onClick={onSort}>
      <button type="button" className="cursor-[inherit] [text-align:inherit]">
        {children}
        {ARROW[sort]}
      </button>
    </th>
  );
}
