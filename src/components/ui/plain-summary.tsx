"use client";

import type { ReactNode } from "react";
import { maskAmountsInText } from "@/lib/utils/format";

/** A page's "in plain words" sentence — one line above the details —
 *  with an optional control at its right (e.g. what a rate counts). */
export function PlainSummary({
  text,
  aside,
}: {
  text?: string;
  aside?: ReactNode;
}) {
  if (!aside)
    return (
      <p className="bg-surface-elevated text-secondary rounded-lg px-3 py-2 text-sm">
        {maskAmountsInText(text ?? "")}
      </p>
    );
  return (
    <div className="bg-surface-elevated flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg px-3 py-2 text-sm">
      {text && <p className="text-secondary">{maskAmountsInText(text)}</p>}
      <div className="ml-auto flex items-center gap-1.5">{aside}</div>
    </div>
  );
}
