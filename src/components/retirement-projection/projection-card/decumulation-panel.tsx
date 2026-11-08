import { DecumulationConfig } from "../decumulation-config";
import type { ProjectionState } from "../projection-table-types";

export function DecumulationPanel({ state }: { state: ProjectionState }) {
  const {
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
  } = state;
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
