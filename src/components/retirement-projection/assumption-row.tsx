import { HelpTip } from "@/components/ui/help-tip";

export function AssumptionRow({
  label,
  value,
  highlight,
  tip,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tip?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className={highlight ? "text-amber-600" : "text-muted"}>
        {label}
        {tip && <HelpTip text={tip} />}
      </span>
      <span
        className={`font-medium ${highlight ? "text-amber-800" : "text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}
