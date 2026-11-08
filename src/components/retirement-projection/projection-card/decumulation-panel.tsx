import { DecumulationConfig } from "../decumulation-config";
import type { ProjectionState } from "../projection-table-types";

export function DecumulationPanel({
  isPersonFiltered,
  personFilterName,
  showDecumConfig,
  setShowDecumConfig,
  withdrawalRoutingMode,
  setWithdrawalRoutingMode,
  withdrawalRoutingModeTouched,
  withdrawalOrder,
  setWithdrawalOrder,
  withdrawalOrderTouched,
  engineSettings,
  withdrawalSplits,
  setWithdrawalSplits,
  withdrawalSplitsTouched,
  withdrawalTaxPref,
  setWithdrawalTaxPref,
}: {
  isPersonFiltered: ProjectionState["isPersonFiltered"];
  personFilterName: ProjectionState["personFilterName"];
  showDecumConfig: ProjectionState["showDecumConfig"];
  setShowDecumConfig: ProjectionState["setShowDecumConfig"];
  withdrawalRoutingMode: ProjectionState["withdrawalRoutingMode"];
  setWithdrawalRoutingMode: ProjectionState["setWithdrawalRoutingMode"];
  withdrawalRoutingModeTouched: ProjectionState["withdrawalRoutingModeTouched"];
  withdrawalOrder: ProjectionState["withdrawalOrder"];
  setWithdrawalOrder: ProjectionState["setWithdrawalOrder"];
  withdrawalOrderTouched: ProjectionState["withdrawalOrderTouched"];
  engineSettings: ProjectionState["engineSettings"];
  withdrawalSplits: ProjectionState["withdrawalSplits"];
  setWithdrawalSplits: ProjectionState["setWithdrawalSplits"];
  withdrawalSplitsTouched: ProjectionState["withdrawalSplitsTouched"];
  withdrawalTaxPref: ProjectionState["withdrawalTaxPref"];
  setWithdrawalTaxPref: ProjectionState["setWithdrawalTaxPref"];
}) {
  return (
    <div className="print:hidden">
      <DecumulationConfig
        isPersonFiltered={isPersonFiltered}
        personFilterName={personFilterName}
        showDecumConfig={showDecumConfig}
        setShowDecumConfig={setShowDecumConfig}
        withdrawalRoutingMode={withdrawalRoutingMode}
        setWithdrawalRoutingMode={setWithdrawalRoutingMode}
        withdrawalRoutingModeTouched={withdrawalRoutingModeTouched}
        withdrawalOrder={withdrawalOrder}
        setWithdrawalOrder={setWithdrawalOrder}
        withdrawalOrderTouched={withdrawalOrderTouched}
        persistedWithdrawalOrder={engineSettings?.withdrawalOrder}
        withdrawalSplits={withdrawalSplits}
        setWithdrawalSplits={setWithdrawalSplits}
        withdrawalSplitsTouched={withdrawalSplitsTouched}
        persistedWithdrawalSplits={engineSettings?.withdrawalSplits}
        withdrawalTaxPref={withdrawalTaxPref}
        setWithdrawalTaxPref={setWithdrawalTaxPref}
        activeSpendingStrategy={engineSettings?.withdrawalStrategy}
        discretionaryWithdrawalOrder={
          engineSettings?.discretionaryWithdrawalOrder
        }
        persistedWithdrawalRoutingMode={engineSettings?.withdrawalRoutingMode}
        enableAcaAwareness={engineSettings?.enableAcaAwareness}
        enableIrmaaAwareness={engineSettings?.enableIrmaaAwareness}
      />
    </div>
  );
}
