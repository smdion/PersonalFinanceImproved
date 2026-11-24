import { maskAmountsInText } from "@/lib/utils/format";

/** A run's engine warnings in one amber box, a line each (nothing when
 *  there are none). */
export function EngineWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
      {warnings.map((w) => (
        <div key={w}>{maskAmountsInText(w)}</div>
      ))}
    </div>
  );
}
