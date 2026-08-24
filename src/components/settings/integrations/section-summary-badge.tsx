/**
 * Shared collapsed-<summary> status badges for the Integrations preview
 * panel's four linking sections (Budget Category Matching, Sinking Fund
 * Matching, Contribution Account Linking, Tracking Account Mappings).
 *
 * Before this, each section rendered its counts a different way — bare
 * colored numbers with no label (Budget/Savings), a "N linked · M unlinked"
 * prose fragment (Contribution), and a "X/Y mapped" fraction (Tracking) —
 * three different visual languages for the same kind of "how much is left
 * to resolve here" summary, and the bare numbers relied on color alone to
 * convey meaning. One consistent "N label" pill per status, always labeled,
 * same color tokens everywhere.
 */
// Matches the colors budget-section.tsx/savings-section.tsx already used
// for this exact dark-summary-line context — not STATUS_STYLES (that's a
// filled-pill treatment for individual match rows on a light background,
// a different context, not this one). "amber" here means the SAME
// yellow-400 both sections already used for "suggested," under one name.
const TONE_CLASSES: Record<"green" | "amber" | "purple" | "faint", string> = {
  green: "text-green-400",
  amber: "text-yellow-400",
  purple: "text-purple-400",
  faint: "text-faint",
};

export function SectionSummaryBadge({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "green" | "amber" | "purple" | "faint";
}) {
  return (
    <span className={`${TONE_CLASSES[tone]} whitespace-nowrap`}>
      {value} {label}
    </span>
  );
}

export function SectionSummaryRow({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-caption">{children}</span>
  );
}
