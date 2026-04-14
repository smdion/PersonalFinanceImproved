/** Shared pill button for toolbar/control bar toggles. */
export function PillBtn({
  active,
  onClick,
  label,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
        disabled
          ? "text-faint cursor-not-allowed"
          : active
            ? "bg-surface-primary text-primary shadow-sm border"
            : "text-muted hover:text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

/** Pill button group container. */
export function PillGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
      {children}
    </div>
  );
}

/** Labeled pill group with optional divider before it. */
export function LabeledPillGroup({
  label,
  children,
  helpTip,
}: {
  label: string;
  children: React.ReactNode;
  helpTip?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-faint font-medium uppercase">
        {label}
        {helpTip}
      </span>
      <PillGroup>{children}</PillGroup>
    </div>
  );
}
