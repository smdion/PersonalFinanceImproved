/** The sr-only sentence a chart's `aria-describedby` points at. Placed
 *  before the chart, out of flow, so no sibling or last-child style moves.
 *  Free of Recharts, for the hand-drawn charts. */
export function ChartSummaryText({ id, text }: { id: string; text: string }) {
  return (
    <span id={id} className="sr-only">
      {text}
    </span>
  );
}
