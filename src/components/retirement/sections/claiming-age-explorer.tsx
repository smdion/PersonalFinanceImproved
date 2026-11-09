"use client";

/**
 * Social Security claiming-age comparison for one person: sweeps ages 62-70 and shows ending net
 * worth per age, recommended age highlighted. Rendered only when `pia` is a positive number.
 */
import { NotConfiguredNotice } from "@/components/ui/not-configured-notice";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer } from "@/components/ui/disclaimer";
import { formatCurrency } from "@/lib/utils/format";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";

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
  /** The household's real profile context: the sweep reruns the actual projection, so pass the
   *  viewed profile ids whenever known. Omitted means "use the active profile". */
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
      selection: profileSelectionFrom({
        retirementProfileId,
        contributionProfileId,
        salaryProfileId,
      }),
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
          ) : query.data && "notConfigured" in query.data ? (
            <NotConfiguredNotice reason={query.data.notConfigured} />
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
                        {c.fails
                          ? "Projection falls short"
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
          <Disclaimer className="mt-1" />
        </div>
      )}
    </div>
  );
}
