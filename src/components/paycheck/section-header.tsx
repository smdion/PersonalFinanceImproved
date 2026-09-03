import React from "react";

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-faint flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <span className="bg-surface-strong h-px flex-1" />
      <span className="shrink-0">{children}</span>
      <span className="bg-surface-strong h-px flex-1" />
    </h4>
  );
}
