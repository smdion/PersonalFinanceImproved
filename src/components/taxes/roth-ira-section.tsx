"use client";

/**
 * Taxes page: Roth IRA MAGI and the direct-vs-backdoor verdict from buildRothIraView (via
 * useRothIra); this only renders. Without the portfolio permission it shows the wage AGI.
 */
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useRothIra } from "@/lib/hooks/use-roth-ira";
import type { InvestmentIncomeBasis } from "@/lib/pure/investments/investment-income";
import { filingStatusLabel } from "@/lib/config/display-labels";
import { ROTH_IRA_MFS_PHASEOUT } from "@/lib/config/tax-params";
import { rothIraAdvice } from "@/lib/pure/contributions/roth-ira-advice";
import { OtherJobsNotes } from "@/components/taxes/other-jobs-note";
import type { RouterOutputs } from "@/lib/trpc";

const BASIS_TEXT: Record<InvestmentIncomeBasis, string> = {
  actual: "the year's actual",
  ytdPlusLastYear: "this year so far plus last year's rest of the year",
  annualized:
    "partly this year so far, annualized (no last-year history for some feeds — a December distribution would be missed)",
  none: "no investment transactions stored for this year",
};

/** Built at render time so privacy mode masks its dollars. */
const notCounted = () =>
  `Not counted: bank/HYSA interest, gains from selling investments, RSU/ESPP and other pay outside salary and bonus, a job change mid-year (only the current job), traditional IRA deductions. Married filing separately isn't modelled: its Roth IRA phase-out is ${formatCurrency(ROTH_IRA_MFS_PHASEOUT.start, 0)}–${formatCurrency(ROTH_IRA_MFS_PHASEOUT.end, 0)}.`;

export function RothIraSection({
  wageAgi,
  people,
}: {
  wageAgi: number;
  /** The paycheck summary's people: a second current job is noted. */
  people: RouterOutputs["paycheck"]["computeSummary"]["people"];
}) {
  const user = useUser();
  const { available, view, inputs, marginSetting, setMarginSetting } =
    useRothIra();

  if (!available || !view) {
    return (
      <Card title="Roth IRA">
        <div className="flex justify-between text-sm">
          <span className="inline-flex items-center">
            AGI from wages (est.)
            <HelpTip
              text="Salary plus bonus, minus the money that comes out before tax (pre-tax 401k, payroll HSA, health insurance) and HSA money you pay in yourself. Investment income isn't included here, so treat it as a floor for things like Roth IRA limits."
              maxWidth={280}
            />
          </span>
          <span>{formatCurrency(wageAgi)}</span>
        </div>
        <p className="text-faint mt-2 text-xs">
          The Roth IRA check needs investment income and IRA balances, which
          need the Portfolio permission.
        </p>
      </Card>
    );
  }

  const j = view.judgement;
  const income = inputs?.investmentIncome;
  const coverageGaps = [
    ...(inputs?.unfedTaxableAccounts.length
      ? [
          `taxable accounts with no feed (${inputs.unfedTaxableAccounts.join(", ")})`,
        ]
      : []),
    ...(inputs?.unlinkedFeedCount
      ? [
          `${inputs.unlinkedFeedCount} feed(s) not counted (not linked to a tracked account, or unchecked)`,
        ]
      : []),
    ...(inputs?.investmentIncome.annualizedFeeds.length
      ? [
          `full-year history for ${inputs.investmentIncome.annualizedFeeds.join(", ")} (annualized)`,
        ]
      : []),
    ...(inputs?.investmentIncome.noHistoryFeeds.length
      ? [`any history for ${inputs.investmentIncome.noHistoryFeeds.join(", ")}`]
      : []),
    ...(inputs?.unownedPreTaxIra
      ? [
          `${formatCurrency(inputs.unownedPreTaxIra, 0)} of pre-tax IRA money with no owner set (left out of the pro-rata check)`,
        ]
      : []),
  ];

  return (
    <Card title="Roth IRA">
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="inline-flex items-center">
            Roth IRA MAGI (est.)
            <HelpTip
              text={`AGI: salary + bonus − pre-tax payroll money − HSA money paid outside payroll (${formatCurrency(view.parts.wageAgi)}), + taxable investment income (${formatCurrency(view.parts.investmentIncome)}: ${income ? BASIS_TEXT[income.basis] : "—"}). Roth conversions aren't counted, as the IRS's Roth IRA MAGI leaves them out. ${notCounted()}${coverageGaps.length ? ` Also missing: ${coverageGaps.join("; ")}.` : ""}`}
              maxWidth={320}
            />
          </span>
          <span>{formatCurrency(view.magi)}</span>
        </div>
        <OtherJobsNotes
          people={people}
          counted="pay is in this MAGI, so it may be low: check the direct limit by hand"
        />
        {j && (
          <>
            <div className="flex justify-between">
              <span>
                Phase-out {formatCurrency(j.phaseOutStart, 0)}–
                {formatCurrency(j.phaseOutEnd, 0)} (
                {filingStatusLabel(view.filingStatus).toLowerCase()})
              </span>
              <span>
                {j.distanceToStart > 0
                  ? `${formatCurrency(j.distanceToStart, 0)} below`
                  : j.verdict === "backdoor"
                    ? "above"
                    : "inside"}
              </span>
            </div>
            <p
              className={
                j.verdict === "direct"
                  ? "text-muted"
                  : "text-primary font-medium"
              }
            >
              {rothIraAdvice(view, "until the tax-filing deadline")?.summary}
            </p>
            <div className="flex justify-between">
              <span>Safety margin below the phase-out</span>
              <InlineEdit
                value={marginSetting === null ? "" : String(marginSetting)}
                isEditable={isAdmin(user)}
                type="number"
                formatDisplay={() =>
                  marginSetting === null
                    ? `${formatCurrency(j.margin, 0)} (range width)`
                    : formatCurrency(j.margin, 0)
                }
                onSave={(raw) => {
                  const n = Number(raw);
                  setMarginSetting(
                    raw.trim() === "" || !Number.isFinite(n) || n < 0
                      ? null
                      : n,
                  );
                }}
              />
            </div>
            {view.pendingConversion.map((p) => (
              <p key={`pending-${p.personId}`} className="text-muted">
                {p.name} has {formatCurrency(p.amount, 0)} in a traditional IRA
                waiting to be converted: after-tax money from the backdoor
                contribution, so the pro-rata rule doesn&apos;t tax it. Convert
                it before Dec 31 so it isn&apos;t counted then.
              </p>
            ))}
            {j.verdict !== "direct" &&
              view.proRata.map((p) => (
                <p key={p.personId} className="text-primary">
                  {p.name} has {formatCurrency(p.amount, 0)} pre-tax in IRAs — a
                  backdoor conversion would be mostly taxable (pro-rata). The
                  Dec 31 balance is what counts
                  {p.hasEmployerPlan
                    ? "; rolling it into the workplace plan before then clears it, if the plan accepts roll-ins."
                    : "."}
                </p>
              ))}
          </>
        )}
      </div>
    </Card>
  );
}
