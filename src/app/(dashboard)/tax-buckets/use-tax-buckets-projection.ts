import type { SetStateAction, Dispatch } from "react";
import { trpc } from "@/lib/trpc";
import { useEffectiveContributionProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import type { FocusStateValue } from "@/lib/config/focus-topics";

/** The At Retirement projection, its query and the basis mutations, in hook order. */
export function useTaxBucketsProjection(
  view: FocusStateValue<"taxBucketsView">,
  setShowBulkBasis: Dispatch<SetStateAction<boolean>>,
) {
  const utils = trpc.useUtils();
  const { queryInput: contributionPick } = useEffectiveContributionProfileId();
  const { queryInput: salaryPick } = useEffectiveSalaryProfileId();
  // Fetched only for "At Retirement", so "now" never pays for the projection.
  // Never stale: it reads what other pages write (a basis edit on
  // Performance), which invalidate only "now".
  const projectionQuery =
    trpc.projection.computeTaxBucketsAtRetirement.useQuery(
      {
        selection: profileSelectionFrom({ ...contributionPick, ...salaryPick }),
      },
      { enabled: view === "atRetirement", staleTime: 0 },
    );
  // A basis or separation edit moves both views.
  const invalidate = () =>
    Promise.all([
      utils.taxBuckets.computeBreakdown.invalidate(),
      utils.projection.computeTaxBucketsAtRetirement.invalidate(),
    ]);

  const updateRothBasis = trpc.taxBuckets.updateRothBasis.useMutation({
    onSuccess: invalidate,
  });
  const updateSeparationDate = trpc.taxBuckets.updateSeparationDate.useMutation(
    { onSuccess: invalidate },
  );
  const batchUpdateRothBasis = trpc.taxBuckets.batchUpdateRothBasis.useMutation(
    {
      onSuccess: () => {
        setShowBulkBasis(false);
        return invalidate();
      },
    },
  );

  return {
    projectionQuery,
    updateRothBasis,
    updateSeparationDate,
    batchUpdateRothBasis,
    projection: projectionQuery.data?.projection ?? null,
  };
}
