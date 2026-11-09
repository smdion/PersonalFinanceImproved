import { useMemo, type SetStateAction, type Dispatch } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-bucket-projection";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import type { FocusStateValue } from "@/lib/config/focus-topics";

/** The At Retirement projection, its query and the basis mutations, in hook order. */
export function useTaxBucketsProjection(
  view: FocusStateValue<"taxBucketsView">,
  utils: ReturnType<typeof trpc.useUtils>,
  setShowBulkBasis: Dispatch<SetStateAction<boolean>>,
  data: RouterOutputs["taxBuckets"]["computeBreakdown"] | undefined,
) {
  const { queryInput: contributionPick } = useEffectiveContribProfileId();
  const { queryInput: salaryPick } = useEffectiveSalaryProfileId();
  // Only fetched when the user actually switches to "At Retirement" — the
  // "now" view stays free of any projected bleed-through, and the page
  // doesn't pay for the heavier call on every visit.
  const projectionQuery = trpc.projection.computeProjection.useQuery(
    { selection: profileSelectionFrom({ ...contributionPick, ...salaryPick }) },
    { enabled: view === "atRetirement" },
  );

  const updateRothBasis = trpc.taxBuckets.updateRothBasis.useMutation({
    onSuccess: () => utils.taxBuckets.computeBreakdown.invalidate(),
  });
  const updateSeparationDate = trpc.taxBuckets.updateSeparationDate.useMutation(
    {
      onSuccess: () => utils.taxBuckets.computeBreakdown.invalidate(),
    },
  );
  const batchUpdateRothBasis = trpc.taxBuckets.batchUpdateRothBasis.useMutation(
    {
      onSuccess: () => {
        utils.taxBuckets.computeBreakdown.invalidate();
        setShowBulkBasis(false);
      },
    },
  );

  const projection = useMemo(() => {
    if (!data || !projectionQuery.data?.result) return null;
    // Rule of 55 forecasting override -- must read the SAME
    // per-person setting the retirement engine reads, or this page and the
    // retirement projection would disagree about the same account's
    // eligibility. `perPersonSettings` rides on the same query result.
    const ruleOf55OverrideByPersonId =
      "perPersonSettings" in projectionQuery.data
        ? new Map(
            projectionQuery.data.perPersonSettings.map((ps) => [
              ps.personId,
              ps.ruleOf55Override,
            ]),
          )
        : undefined;
    // Each person's retirement year — the same figure the engine uses for
    // when a still-active job ends.
    const birthYears = new Map(data.people.map((p) => [p.id, p.birthYear]));
    const retirementYearByPersonId =
      "perPersonSettings" in projectionQuery.data
        ? new Map(
            projectionQuery.data.perPersonSettings.flatMap((ps) => {
              const by = birthYears.get(ps.personId);
              return by != null
                ? [[ps.personId, by + ps.retirementAge] as const]
                : [];
            }),
          )
        : undefined;
    return computeTaxBucketProjection({
      nowEntries: data.accounts,
      projectionByYear: projectionQuery.data.result.projectionByYear,
      people: data.people,
      ruleOf55OverrideByPersonId,
      retirementYearByPersonId,
    });
  }, [data, projectionQuery.data]);

  return {
    projectionQuery,
    updateRothBasis,
    updateSeparationDate,
    batchUpdateRothBasis,
    projection,
  };
}
