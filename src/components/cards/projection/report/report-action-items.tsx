/** Action-items section of the advisor report — recommendations plus the
 *  engine's own raw disclosure warnings (kept separate: recommendations
 *  above are derived from structured fields, disclosures below are the
 *  engine's own warning text, never parsed — see
 *  lib/pure/report/action-items.ts). Presentational only. */
import type { ActionItemsSection } from "@/lib/pure/report/action-items";

export function ReportActionItemsSection({
  actionItems,
}: {
  actionItems: ActionItemsSection;
}) {
  if (actionItems.items.length === 0 && actionItems.disclosures.length === 0) {
    return null;
  }
  return (
    <section className="mb-6" style={{ breakInside: "avoid" }}>
      <h2 className="text-lg font-semibold mb-2">Recommendations</h2>
      {actionItems.items.length > 0 ? (
        <ol className="text-sm space-y-2 list-decimal list-inside">
          {actionItems.items.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}.</span> {item.detail}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">
          No specific recommendations — this plan looks solid based on the
          analysis above.
        </p>
      )}
      {actionItems.disclosures.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted mb-1">
            Additional notes from your projection
          </p>
          <ul className="text-xs text-muted space-y-0.5 list-disc list-inside">
            {actionItems.disclosures.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
