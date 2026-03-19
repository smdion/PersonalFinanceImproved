const colorStyles = {
  gray: "bg-surface-strong text-muted",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  purple: "bg-purple-50 text-purple-600",
  indigo: "bg-indigo-50 text-indigo-700",
} as const;

type BadgeProps = {
  children: React.ReactNode;
  color?: keyof typeof colorStyles;
  className?: string;
};

/**
 * General-purpose badge for status indicators, labels, and tags.
 *
 * For account-type badges (401k, IRA, etc.), use AccountBadge instead —
 * it derives colors from the centralized account-types config.
 */
export function Badge({ children, color = "gray", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${colorStyles[color]} ${className}`}
    >
      {children}
    </span>
  );
}
