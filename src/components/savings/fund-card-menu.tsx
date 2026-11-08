import type { Dispatch, SetStateAction } from "react";
import { isGoalMet } from "@/lib/pure/savings/savings-goal-met";
import { confirm } from "@/components/ui/confirm-dialog";
import type { GoalProjection, RawGoal } from "./types";

export function FundCardMenuItems({
  onLinkToApi,
  rawGoal,
  setShowMenu,
  onUnlinkFromApi,
  onGoalUpdate,
  projection,
  onGoalUpdateMulti,
  onConvertToBudgetItem,
  savingsGoal,
  onDeleteGoal,
}: {
  onLinkToApi: ((goalId: number) => void) | undefined;
  rawGoal: RawGoal;
  setShowMenu: Dispatch<SetStateAction<boolean>>;
  onUnlinkFromApi: ((goalId: number) => void) | undefined;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  projection: GoalProjection;
  onGoalUpdateMulti:
    | ((goalId: number, fields: Record<string, string | null>) => void)
    | undefined;
  onConvertToBudgetItem:
    ((goalId: number, name: string, goalMet: boolean) => void) | undefined;
  savingsGoal: { current: number; target: number };
  onDeleteGoal: (params: { id: number }) => void;
}) {
  return (
    <>
      {onLinkToApi && !rawGoal.isApiSyncEnabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(false);
            onLinkToApi(rawGoal.id);
          }}
          className="hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs text-blue-600 transition-colors"
        >
          Link to API
        </button>
      )}
      {onUnlinkFromApi && rawGoal.isApiSyncEnabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(false);
            onUnlinkFromApi(rawGoal.id);
          }}
          className="text-faint hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs transition-colors"
        >
          Unlink API
        </button>
      )}
      {rawGoal.targetMode !== "fixed" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(false);
            onGoalUpdate(projection.goalId, "targetMode", "fixed");
          }}
          className="text-secondary hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs transition-colors"
        >
          Set Fixed Target
        </button>
      )}
      {rawGoal.targetMode !== "ongoing" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(false);
            if (onGoalUpdateMulti) {
              onGoalUpdateMulti(projection.goalId, {
                targetMode: "ongoing",
                targetAmount: null,
                targetDate: null,
              });
            } else {
              onGoalUpdate(projection.goalId, "targetMode", "ongoing");
            }
          }}
          className="text-secondary hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs transition-colors"
        >
          Set Ongoing
        </button>
      )}
      {rawGoal.targetMode !== "bucket" && onGoalUpdateMulti && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(false);
            onGoalUpdateMulti(projection.goalId, {
              targetMode: "bucket",
              targetAmount: null,
              targetDate: null,
              monthlyContribution: "0",
              allocationPercent: null,
            });
          }}
          className="text-secondary hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs transition-colors"
        >
          Set as Bucket
        </button>
      )}
      {onConvertToBudgetItem && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            setShowMenu(false);
            const goalMet = isGoalMet({
              targetMode: rawGoal.targetMode,
              target: savingsGoal.target,
              current: savingsGoal.current,
            });
            if (
              await confirm(
                `${goalMet ? `"${projection.name}" has met its goal. ` : ""}Convert "${projection.name}" to a budget item? Its monthly funding carries over. This will delete the sinking fund and its history.`,
              )
            )
              onConvertToBudgetItem(rawGoal.id, projection.name, goalMet);
          }}
          className="hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs text-amber-600 transition-colors"
        >
          → Budget Item
        </button>
      )}
      <button
        onClick={async (e) => {
          e.stopPropagation();
          setShowMenu(false);
          if (await confirm(`Delete "${projection.name}"?`))
            onDeleteGoal({ id: rawGoal.id });
        }}
        className="hover:bg-surface-elevated block w-full px-3 py-1 text-left text-xs text-red-600 transition-colors"
      >
        Delete Fund
      </button>
    </>
  );
}
