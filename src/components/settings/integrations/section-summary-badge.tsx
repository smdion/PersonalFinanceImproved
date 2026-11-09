/**
 * Collapsed-<summary> status badges for the Integrations preview panel's four linking sections:
 * one labeled "N label" pill per status, same color tokens everywhere.
 */
// Tones for the dark summary line (STATUS_STYLES is for filled pills on a light
// background); "amber" is the yellow-400 used for "suggested".
const TONE_CLASSES: Record<
  "green" | "amber" | "purple" | "faint" | "red",
  string
> = {
  green: "text-green-400",
  amber: "text-yellow-400",
  purple: "text-purple-400",
  faint: "text-faint",
  red: "text-red-400",
};

export function SectionSummaryBadge({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "green" | "amber" | "purple" | "faint" | "red";
}) {
  return (
    <span className={`${TONE_CLASSES[tone]} whitespace-nowrap`}>
      {value} {label}
    </span>
  );
}

export function SectionSummaryRow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-caption flex items-center gap-2">{children}</span>
  );
}
