import { useUser, hasPermission } from "@/lib/context/user-context";
import { HoldingHistorySection } from "@/components/investments/holding-history-section";
import { FocusTarget } from "@/components/ui/focus-target";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ContributionAccountsSettings } from "@/components/contributions/contribution-accounts";
import { CardBoundary } from "@/components/dashboard/utils";

export type PortfolioSettingsSectionsProps = {
  setShowHoldings: (open: boolean) => void;
  showHoldings: boolean;
  user: ReturnType<typeof useUser>;
};

export function PortfolioSettingsSections({
  setShowHoldings,
  showHoldings,
  user,
}: PortfolioSettingsSectionsProps) {
  return (
    <>
      {/* Account & Contribution Settings — unified table for goal/owner/contributions */}
      <CardBoundary title="Contribution Account Settings">
        <div className="mt-8">
          <ContributionAccountsSettings />
        </div>
      </CardBoundary>
      {/* What each account held over time — entered here, read by
          Benchmarks' "Your mix, in index funds". */}
      {hasPermission(user, "portfolio") && (
        <CardBoundary title="Holding history">
          <FocusTarget topic="holdingHistory" className="mt-8">
            <CollapsibleSection
              title="Holding history"
              open={showHoldings}
              onToggle={() => setShowHoldings(!showHoldings)}
            >
              <HoldingHistorySection />
            </CollapsibleSection>
          </FocusTarget>
        </CardBoundary>
      )}
    </>
  );
}
