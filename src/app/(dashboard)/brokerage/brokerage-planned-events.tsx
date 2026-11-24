/** The Brokerage page's planned events: the saved ones and the form to add one. */
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { investedAtStartOf } from "@/lib/pure/advice/goldilocks";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/retirement-projection/lump-sum-form";
import { accountOption } from "@/components/retirement-projection/lump-sum-target";
import { isPortfolioParent } from "@/lib/config/account-types";
import type { LumpSumEvent } from "@/components/retirement-projection/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EngineWarnings } from "@/components/retirement-projection/engine-warnings";

export type PlannedEventsCardProps = {
  brokerageLumpSums: LumpSumEvent[];
  data: NonNullable<RouterOutputs["projection"]["computeProjection"]> & {
    result: NonNullable<
      NonNullable<RouterOutputs["projection"]["computeProjection"]>["result"]
    >;
  };
  setBrokerageLumpSums: (
    updater: LumpSumEvent[] | ((prev: LumpSumEvent[]) => LumpSumEvent[]),
  ) => void;
};

export function PlannedEventsCard({
  brokerageLumpSums,
  data,
  setBrokerageLumpSums,
}: PlannedEventsCardProps) {
  // The saved events this page leaves out (an account type this version
  // doesn't know); a save keeps them.
  const notes =
    trpc.retirement.projectionOverrides.listUnknownTypeNotes.useQuery({
      overrideType: "brokerage",
    }).data ?? [];
  return (
    <Card title="Planned Events" className="mt-6">
      <p className="text-muted mb-2 text-xs">
        One-time injections or withdrawals that modify the projection (bonus,
        inheritance, down payment).
        <HelpTip text="Unlike goals (which set a target and let the engine decide if it's funded), planned events directly add or remove dollars in a specific year." />
      </p>
      <EngineWarnings warnings={notes} />
      {brokerageLumpSums.length > 0 && (
        <div className="mb-3 space-y-1">
          {brokerageLumpSums.map((ls) => (
            <LumpSumBadge
              key={ls.id}
              event={ls}
              onDelete={() =>
                setBrokerageLumpSums((prev) =>
                  prev.filter((x) => x.id !== ls.id),
                )
              }
            />
          ))}
        </div>
      )}
      <LumpSumForm
        accounts={
          data.result.projectionByYear[0]?.individualAccountBalances
            .filter((ia) => isPortfolioParent(ia.parentCategory))
            .map((ia) => accountOption(ia, false)) ?? []
        }
        onAdd={(ls) => setBrokerageLumpSums((prev) => [...prev, ls])}
        allowWithdrawals
        investedAtStartOf={(year) =>
          investedAtStartOf(data.result.projectionByYear, year)
        }
      />
    </Card>
  );
}
