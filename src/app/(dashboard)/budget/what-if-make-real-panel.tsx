import { trpc } from "@/lib/trpc";
import {
  getParentCategory,
  getDefaultTaxTreatment,
} from "@/lib/config/account-types";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import { type ContribAddition } from "./what-if-editors";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfMakeRealPanelProps = {
  createContribAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.create.useMutation
  >;
  handleSaveMakeReal: (values: ContribAccountFormValues) => void;
  makeRealAddition: ContribAddition | null;
  setMakeRealAddition: Dispatch<SetStateAction<ContribAddition | null>>;
  updateContribAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.update.useMutation
  >;
};

export function WhatIfMakeRealPanel({
  createContribAccount,
  handleSaveMakeReal,
  makeRealAddition,
  setMakeRealAddition,
  updateContribAccount,
}: WhatIfMakeRealPanelProps) {
  return (
    <SlidePanel
      isOpen={makeRealAddition != null}
      onClose={() => setMakeRealAddition(null)}
      title="Make Real: Contribution Account"
    >
      {makeRealAddition && (
        <ContribAccountForm
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
            createContribAccount.isPending || updateContribAccount.isPending
          }
        />
      )}
    </SlidePanel>
  );
}
