"use client";

import { maskAmountsInText } from "@/lib/utils/format";

/** A page's "in plain words" sentence — one line above the details. */
export function PlainSummary({ text }: { text: string }) {
  return (
    <p className="bg-surface-elevated text-secondary rounded-lg px-3 py-2 text-sm">
      {maskAmountsInText(text)}
    </p>
  );
}
