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
      <h2 className="mb-2 text-lg font-semibold">Recommendations</h2>
      {actionItems.items.length > 0 ? (
        <ol className="list-inside list-decimal space-y-2 text-sm">
          {actionItems.items.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}.</span> {item.detail}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted text-sm">
          No specific recommendations — this plan looks solid based on the
          analysis above.
        </p>
      )}
      {actionItems.disclosures.length > 0 && (
        <div className="mt-3">
          <p className="text-muted mb-1 text-xs font-medium">
            Additional notes from your projection
          </p>
          <ul className="text-muted list-inside list-disc space-y-0.5 text-xs">
            {actionItems.disclosures.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
