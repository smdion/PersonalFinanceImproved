/** The Roth conversion rate select: a saved rate shows as itself, one outside the list too ("Off
 *  (rate 0)" for 0); with none saved, a placeholder names the ceiling the conversion falls back to. */
import { formatPercent } from "@/lib/utils/format";

const LISTED_RATES = [0.1, 0.12, 0.22, 0.24];

/** The select's value for a saved rate: the rate as a number string, or "" (the placeholder). */
export const conversionRateValue = (saved: string | null | undefined) =>
  saved == null ? "" : String(Number(saved));

export function ConversionRateOptions({
  saved,
  ceiling,
}: {
  saved: string | null | undefined;
  ceiling: number;
}) {
  const rate = saved == null ? null : Number(saved);
  return (
    <>
      {rate === null && (
        <option value="" disabled>
          Same as Bracket Ceiling ({formatPercent(ceiling, 0)})
        </option>
      )}
      {rate !== null && !LISTED_RATES.includes(rate) && (
        <option value={String(rate)}>
          {rate === 0 ? "Off (rate 0)" : formatPercent(rate, 0)}
        </option>
      )}
      {LISTED_RATES.map((r) => (
        <option key={r} value={String(r)}>
          {formatPercent(r, 0)}
        </option>
      ))}
    </>
  );
}
