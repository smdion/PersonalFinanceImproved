"use client";

import type { ReactNode } from "react";

const TONES = {
  /** A quiet action that turns green on hover (activate). */
  positive: "text-caption text-faint hover:text-green-600",
  /** A quiet action that turns blue on hover (clone). */
  neutral: "text-caption text-faint hover:text-blue-600",
  /** A quiet action that turns red on hover (delete). */
  danger: "text-caption text-faint hover:text-red-600",
  /** A blue link-like action (+ New). */
  link: "text-caption font-medium text-blue-600 hover:text-blue-700",
} as const;

/** A small text action in a list header or row. */
export function TextAction({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof TONES;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={TONES[tone]}>
      {children}
    </button>
  );
}
