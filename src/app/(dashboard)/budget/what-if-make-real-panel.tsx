import { trpc } from "@/lib/trpc";
import {
  getParentCategory,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  ContributionAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import { type ContributionAddition } from "./what-if-editors";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfMakeRealPanelProps = {
  createContributionAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.create.useMutation
  >;
  handleSaveMakeReal: (values: ContribAccountFormValues) => void;
  makeRealAddition: ContributionAddition | null;
  setMakeRealAddition: Dispatch<SetStateAction<ContributionAddition | null>>;
  updateContributionAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.update.useMutation
  >;
};

export function WhatIfMakeRealPanel({
  createContributionAccount,
  handleSaveMakeReal,
  makeRealAddition,
  setMakeRealAddition,
  updateContributionAccount,
}: WhatIfMakeRealPanelProps) {
  return (
    <SlidePanel
      isOpen={makeRealAddition != null}
      onClose={() => setMakeRealAddition(null)}
      title="Make Real: Contribution Account"
    >
      {makeRealAddition && (
        <ContributionAccountForm
          initialValues={{
            personId: makeRealAddition.personId,
            accountType: makeRealAddition.accountType,
            parentCategory: getParentCategory(makeRealAddition.accountType),
            taxTreatment: getDefaultTaxTreatment(
              makeRealAddition.accountType,
            ) as "pre_tax" | "tax_free" | "after_tax" | "hsa",
          }}
          onSave={handleSaveMakeReal}
          onCancel={() => setMakeRealAddition(null)}
          isPending={
            createContributionAccount.isPending ||
            updateContributionAccount.isPending
          }
        />
      )}
    </SlidePanel>
  );
}
