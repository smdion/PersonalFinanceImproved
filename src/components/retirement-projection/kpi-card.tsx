import { HelpTip } from "@/components/ui/help-tip";

// ---------------------------------------------------------------------------
// Unified card chrome — matches projection-mc-results.tsx summary bar
// ---------------------------------------------------------------------------

export function KpiCard({
  label,
  tooltip,
  children,
  className = "",
}: {
  label: string;
  tooltip?: (string | React.ReactNode)[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-subtle bg-surface-primary/40 flex flex-col rounded-lg border px-3 py-2.5 ${className}`}
    >
      <div className="text-caption text-faint flex items-center gap-1 font-semibold tracking-wider uppercase">
        {label}
        {tooltip && <HelpTip maxWidth={420} lines={tooltip} />}
      </div>
      <div className="mt-2 flex flex-1 flex-col">{children}</div>
    </div>
  );
}
