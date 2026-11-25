/** The Withdrawal Routing select's options; a saved mode this version doesn't
 *  know is shown as itself ("Unknown (…)"), so the select never shows another
 *  mode as saved. The projection runs it as the default and notes it. */
import {
  DEFAULT_WITHDRAWAL_ROUTING_MODE,
  WITHDRAWAL_ROUTING_MODES,
  WITHDRAWAL_ROUTING_MODE_LABELS,
  knownRoutingMode,
} from "@/lib/config/withdrawal-routing";

export function RoutingModeOptions({ stored }: { stored: string }) {
  return (
    <>
      {knownRoutingMode(stored) === null && (
        <option value={stored} disabled>
          Unknown ({stored})
        </option>
      )}
      {WITHDRAWAL_ROUTING_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {WITHDRAWAL_ROUTING_MODE_LABELS[mode]}
          {mode === DEFAULT_WITHDRAWAL_ROUTING_MODE ? " (default)" : ""}
        </option>
      ))}
    </>
  );
}
