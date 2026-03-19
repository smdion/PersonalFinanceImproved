import React from "react";

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold text-faint uppercase tracking-wider flex items-center gap-2">
      <span className="flex-1 h-px bg-surface-strong" />
      <span className="shrink-0">{children}</span>
      <span className="flex-1 h-px bg-surface-strong" />
    </h4>
  );
}
