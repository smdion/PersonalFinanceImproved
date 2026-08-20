import { STATUS_COLORS } from "@/lib/utils/colors";

// red/green/amber/blue render from the shared STATUS_COLORS token (Phase
// 4a) — Badge's bg+text pair is the source those shades were seeded from,
// so this is a self-reference back to the values that used to live here
// directly. gray/purple/indigo aren't "status" semantics and stay local.
const colorStyles = {
  gray: "bg-surface-strong text-muted",
  blue: `${STATUS_COLORS.blue.bg} ${STATUS_COLORS.blue.text}`,
  green: `${STATUS_COLORS.green.bg} ${STATUS_COLORS.green.text}`,
  red: `${STATUS_COLORS.red.bg} ${STATUS_COLORS.red.text}`,
  amber: `${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.text}`,
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
export function Badge({
  children,
  color = "gray",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-micro font-semibold uppercase tracking-wide ${colorStyles[color]} ${className}`}
    >
      {children}
    </span>
  );
}
