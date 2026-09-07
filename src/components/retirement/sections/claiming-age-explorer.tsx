"use client";

/**
 * Social Security claiming-age comparison — one person, opted into PIA.
 * Runs `sweepSocialSecurityClaimingAges` (ages 62-70) and shows the
 * ending-net-worth comparison, with the recommended age highlighted.
 *
 * Gated entirely on `pia` being a real positive number — a person who
 * hasn't opted into PIA has nothing to compare (their benefit isn't
 * claiming-age-adjusted at all, per SOCIAL-SECURITY-OPTIMIZATION-PLAN.md
 * decision #1/#5), so this component is never rendered for them (see
 * `SocialSecuritySection`'s call site).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/format";

type Props = {
  personId: number;
  /** This person's PIA, ANNUALIZED (the stored value is monthly — the
   *  caller runs it through `parseAnnualPia`), already validated positive.
   *  Passed straight to the sweep endpoint, which expects annual. */
  pia: number;
  /** Display label, e.g. "Alex" for a multi-person household or null for
   *  a single-person one (matches SocialSecuritySection's own "X's
   *  Benefit" vs "Monthly Benefit" labeling convention). */
  personName: string | null;
  /** The household's REAL profile/pin context — NOT cosmetic. The sweep
   *  reruns the household's actual projection at each candidate age
   *  (budget, expenses, and depletion all come from these), so a
   *  household viewing a non-active Retirement Profile, or with a pinned
   *  contribution/salary profile, must resolve against THAT data, not
   *  silently fall back to whatever's globally active. Omitted (not
   *  passed at all) only means "use the global default," same as every
   *  other projection endpoint's optional-id convention — never omit
   *  these when the caller has real values, which SocialSecuritySection
   *  always does. */
  retirementProfileId?: number;
  contributionProfileId?: number;
  salaryProfileId?: number;
};

export function ClaimingAgeExplorer({
  personId,
  pia,
  personName,
  retirementProfileId,
  contributionProfileId,
  salaryProfileId,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const query = trpc.projection.sweepSocialSecurityClaimingAges.useQuery(
    {
      personId,
      pia,
      retirementProfileId,
      contributionProfileId,
      salaryProfileId,
    },
    { enabled: expanded, placeholderData: (prev) => prev },
  );
  const result = query.data?.result ?? null;
  const candidatesByAge = [...(result?.candidates ?? [])].sort(
    (a, b) => a.claimingAge - b.claimingAge,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-caption text-faint hover:text-secondary underline"
      >
        {expanded ? "Hide" : "Compare"} claiming ages
        {personName ? ` for ${personName}` : ""} {expanded ? "▲" : "▼"}
      </button>
      <HelpTip text="Runs your real projection at every claiming age from 62 to 70 and compares ending net worth. Excludes any age that would run out the portfolio entirely." />

      {expanded && (
        <div className="bg-surface-elevated mt-2 overflow-x-auto rounded border p-2">
          {query.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !result ? (
            <p className="text-caption text-muted">
              Couldn&apos;t compute a comparison for this household.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="pr-3 font-medium">Age</th>
                  <th className="pr-3 font-medium">Annual Benefit</th>
                  <th className="pr-3 font-medium">Ending Net Worth</th>
                  <th className="font-medium" />
                </tr>
              </thead>
              <tbody>
                {candidatesByAge.map((c) => {
                  const isRecommended =
                    result.recommendedAge != null &&
                    c.claimingAge === result.recommendedAge;
                  return (
                    <tr
                      key={c.claimingAge}
                      className={
                        isRecommended ? "bg-accent/10 font-semibold" : undefined
                      }
                    >
                      <td className="py-0.5 pr-3">{c.claimingAge}</td>
                      <td className="py-0.5 pr-3">
                        {formatCurrency(c.adjustedAnnualBenefit)}/yr
                      </td>
                      <td className="py-0.5 pr-3">
                        {c.depleted
                          ? "Portfolio depleted"
                          : formatCurrency(c.finalNetWorth)}
                      </td>
                      <td className="text-accent py-0.5">
                        {isRecommended ? "Recommended" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="text-caption text-faint mt-2">
            Compares your real projection at each claiming age, holding
            everything else (withdrawal strategy, budget) the same — it
            doesn&apos;t weigh health, other income, or survivor needs, and
            isn&apos;t a substitute for advice specific to your situation.
          </p>
        </div>
      )}
    </div>
  );
}
