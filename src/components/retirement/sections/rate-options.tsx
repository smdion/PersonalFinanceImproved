/** The rate selects' entries (Roth conversion rate, Bracket Ceiling). A saved rate always shows as
 *  itself: one outside the list gets its own entry, so the select never shows another rate. */
import { formatPercent } from "@/lib/utils/format";

/** The select's value for a saved rate: the rate as a number string, or "" (the placeholder). */
export const conversionRateValue = (saved: string | null | undefined) =>
  saved == null ? "" : String(Number(saved));

function SavedRateOptions({
  saved,
  rates,
  label,
}: {
  saved: number | null;
  rates: readonly number[];
  label: (rate: number) => string;
}) {
  return (
    <>
      {saved !== null && !rates.includes(saved) && (
        <option value={String(saved)}>{label(saved)}</option>
      )}
      {rates.map((r) => (
        <option key={r} value={String(r)}>
          {label(r)}
        </option>
      ))}
    </>
  );
}

/** The conversion rate's entries: "Off (rate 0)" for a saved 0; with none saved, a placeholder
 *  names the ceiling the conversion falls back to. */
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
      <SavedRateOptions
        saved={rate}
        rates={[0.1, 0.12, 0.22, 0.24]}
        label={(r) => (r === 0 ? "Off (rate 0)" : formatPercent(r, 0))}
      />
    </>
  );
}

/** The Bracket Ceiling's entries; `withIncome` adds each bracket's rough MFJ income top. */
export function CeilingOptions({
  saved,
  withIncome = false,
}: {
  saved: number;
  withIncome?: boolean;
}) {
  const income: Record<number, string> = {
    0.1: "~$30k",
    0.12: "~$116k",
    0.22: "~$226k",
    0.24: "~$414k",
    0.32: "~$526k",
  };
  return (
    <SavedRateOptions
      saved={saved}
      rates={[0.1, 0.12, 0.22, 0.24, 0.32]}
      label={(r) =>
        withIncome && income[r]
          ? `${formatPercent(r, 0)} (${income[r]} MFJ)`
          : formatPercent(r, 0)
      }
    />
  );
}
