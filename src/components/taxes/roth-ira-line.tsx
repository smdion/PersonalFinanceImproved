/** The Household Income card's Roth IRA line: MAGI and the verdict in a few words (useRothIra). */
import { FocusLink } from "@/components/ui/focus-link";
import { formatCurrency } from "@/lib/utils/format";
import { useRothIra } from "@/lib/hooks/use-roth-ira";

/** Verdict in a few words — the dashboard line. */
const SHORT_VERDICT = {
  direct: "Direct OK",
  tooClose: "Too close to call",
  backdoor: "Use backdoor",
} as const;

/**
 * One line for the Household Income card: Roth IRA MAGI and the verdict in
 * a few words; the detail is on the Taxes page. Without the
 * portfolio permission, the wage AGI.
 */
export function RothIraLine({ wageAgi }: { wageAgi: number }) {
  const { available, view } = useRothIra();
  const j = view?.judgement ?? null;
  return (
    <div className="flex justify-between">
      {/* The detail is on Taxes this year → Roth IRA. */}
      <FocusLink focus={{ topic: "rothIra" }} className="hover:underline">
        {available && view ? "Roth IRA MAGI (est.)" : "AGI from wages (est.)"}
      </FocusLink>
      <span>
        {j && (
          <span
            className={
              j.verdict === "direct" ? "mr-2" : "text-primary mr-2 font-medium"
            }
          >
            {SHORT_VERDICT[j.verdict]}
          </span>
        )}
        {formatCurrency(available && view ? view.magi : wageAgi)}
      </span>
    </div>
  );
}
