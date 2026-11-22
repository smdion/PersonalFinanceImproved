/** A table row's "N warnings" badge, with its notices in a tooltip. */
import { Tooltip } from "@/components/ui/tooltip";
import { maskAmountsInText } from "@/lib/utils/format";
import type { ProjectionState } from "../projection-table-types";

export function YearNoticesBadge({
  notices,
  renderTooltip,
}: {
  notices: readonly string[];
  renderTooltip: ProjectionState["renderTooltip"];
}) {
  if (notices.length === 0) return null;
  return (
    <Tooltip
      content={renderTooltip({
        kind: "info",
        lines: notices.map((w) => ({
          text: maskAmountsInText(w),
          style: "note" as const,
        })),
      })}
      side="left"
    >
      <span className="ml-1 text-amber-500">
        {notices.length} warning
        {notices.length > 1 ? "s" : ""}
      </span>
    </Tooltip>
  );
}
