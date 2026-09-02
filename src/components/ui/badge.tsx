/**
 * Badge — the one tinted-pill primitive for status, labels, tags, and
 * counts. Every ad-hoc `<span className="bg-x-50 text-x-700 px-1 rounded">`
 * should be one of these.
 *
 * Theme-awareness is free: the project's `--c-*` color primitives are
 * swapped per theme (`globals.css`), so `bg-blue-100 text-blue-700` renders
 * as a light pill in light mode and a dark-tinted pill in dark mode with no
 * `dark:` prefixes. Do not add `dark:` overrides at call sites — if a shade
 * looks wrong in one theme, fix the primitive, not the badge.
 *
 * Contrast: every `color` clears WCAG AA (4.5:1) in BOTH themes for the
 * filled and subtle treatments.
 *
 * For account-type badges (401k, IRA, …) use `AccountBadge` — it derives
 * its color from the account-types config.
 */

export type BadgeColor =
  "gray" | "blue" | "green" | "amber" | "red" | "purple" | "indigo";

// Filled: tinted background + readable foreground. `-100` bg / `-700`–`-800`
// text — matches STATUS_COLORS and AccountBadge.
const FILL: Record<BadgeColor, string> = {
  gray: "bg-surface-strong text-muted",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  purple: "bg-purple-100 text-purple-700",
  indigo: "bg-indigo-100 text-indigo-700",
};

// Subtle: colored text only, no fill — for inline tags on an already-tinted
// row or a dark strip where a filled pill would be too heavy.
const SUBTLE: Record<BadgeColor, string> = {
  gray: "text-muted",
  blue: "text-blue-700",
  green: "text-green-700",
  amber: "text-amber-800",
  red: "text-red-700",
  purple: "text-purple-700",
  indigo: "text-indigo-700",
};

const SIZE = {
  xs: "text-micro px-1.5 py-0.5",
  sm: "text-caption px-2 py-0.5",
} as const;

const SIZE_SUBTLE = {
  xs: "text-micro",
  sm: "text-caption",
} as const;

type BadgeProps = {
  children: React.ReactNode;
  /** Semantic color. Default `gray`. */
  color?: BadgeColor;
  /** `xs` (default, `text-micro`) or `sm` (`text-caption`). */
  size?: keyof typeof SIZE;
  /** `rounded` (default) or `pill` (fully rounded — for status chips). */
  shape?: "rounded" | "pill";
  /** `upper` (default, uppercase + tracking) or `normal` (as written). */
  case?: "upper" | "normal";
  /** Colored text with no background fill. */
  subtle?: boolean;
  /** Native tooltip (hover title). */
  title?: string;
  className?: string;
};

export function Badge({
  children,
  color = "gray",
  size = "xs",
  shape = "rounded",
  case: textCase = "upper",
  subtle = false,
  title,
  className = "",
}: BadgeProps) {
  const tone = subtle ? SUBTLE[color] : FILL[color];
  const box = subtle
    ? SIZE_SUBTLE[size]
    : `${SIZE[size]} ${shape === "pill" ? "rounded-full" : "rounded"}`;
  const casing =
    textCase === "upper" ? "uppercase tracking-wide" : "normal-case";
  return (
    <span
      title={title}
      className={`inline-flex items-center font-semibold ${casing} ${box} ${tone} ${className}`}
    >
      {children}
    </span>
  );
}

// ── StatusDot ──────────────────────────────────────────────────────────
// The one small solid indicator for legends and status rows. Solid `-500`
// fills read in both themes (dark `-500` primitives are lightened).

export type DotColor =
  "gray" | "blue" | "green" | "amber" | "red" | "purple" | "indigo";

const DOT_FILL: Record<DotColor, string> = {
  gray: "bg-surface-emphasis",
  blue: "bg-blue-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
  indigo: "bg-indigo-500",
};

const DOT_SIZE = {
  xs: "w-1.5 h-1.5",
  sm: "w-2 h-2",
} as const;

export function StatusDot({
  color = "gray",
  size = "sm",
  pulse = false,
  className = "",
}: {
  color?: DotColor;
  size?: keyof typeof DOT_SIZE;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${DOT_FILL[color]} ${pulse ? "animate-pulse" : ""} ${className}`}
      aria-hidden="true"
    />
  );
}
