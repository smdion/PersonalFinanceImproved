"use client";

/**
 * The household's Roth IRA view (buildRothIraView). The investment side needs the
 * portfolio permission; without it the view is null.
 */
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { SK_ROTH_IRA_DIRECT_MARGIN } from "@/lib/constants/settings-keys";
import {
  buildRothIraView,
  type RothIraView,
} from "@/lib/pure/contributions/roth-ira";
import { otherIraMoney } from "@/lib/pure/contributions/roth-ira-summary";
import type { RouterOutputs } from "@/lib/trpc";

type RothIraInputs = RouterOutputs["investments"]["getRothIraInputs"];

export function useRothIra(): {
  isLoading: boolean;
  /** The viewer can see the investment side (portfolio permission). */
  available: boolean;
  view: RothIraView | null;
  /** The tax year the view is for (the Paycheck page's year). */
  taxYear: number | null;
  inputs: RothIraInputs | null;
  /** The household's margin setting (null = the phase-out width). */
  marginSetting: number | null;
  setMarginSetting: (value: number | null) => void;
} {
  const user = useUser();
  const available = hasPermission(user, "portfolio");
  const summary = useHouseholdIncomeSummary();
  const taxYear = summary.data?.taxYear ?? null;
  const inputs = trpc.investments.getRothIraInputs.useQuery(
    { taxYear: taxYear ?? 0 },
    { enabled: available && taxYear !== null },
  );
  const [marginSetting, setMarginSetting] = usePersistedSetting<number | null>(
    SK_ROTH_IRA_DIRECT_MARGIN,
    null,
  );

  const data = summary.data;
  const view =
    available &&
    data?.rothIra &&
    data.householdTax &&
    data.householdIncome &&
    inputs.data
      ? buildRothIraView({
          rothIra: data.rothIra,
          wageAgi: data.householdTax.wageAgi,
          investmentIncome: inputs.data.investmentIncome.estimate,
          preTaxIraByPerson: inputs.data.preTaxIraByPerson,
          pendingConversionByPerson: inputs.data.pendingConversionByPerson,
          otherIraByPerson: data.people.map((r) => ({
            personId: r.person.id,
            amount: otherIraMoney(r.rawContribs),
          })),
          marginOverride: marginSetting,
        })
      : null;
  return {
    isLoading: summary.isLoading || (available && inputs.isLoading),
    available,
    view,
    taxYear,
    inputs: inputs.data ?? null,
    marginSetting,
    setMarginSetting,
  };
}
