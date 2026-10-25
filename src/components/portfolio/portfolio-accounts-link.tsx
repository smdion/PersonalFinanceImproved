import { FocusLink } from "@/components/ui/focus-link";
import { LINK_CLASS } from "@/components/ui/settings-link";

/** Link to Portfolio → Account & Contribution Settings (opened and scrolled to). */
export function PortfolioAccountsLink({
  className = LINK_CLASS,
}: {
  className?: string;
}) {
  return (
    <FocusLink focus={{ topic: "portfolioAccounts" }} className={className}>
      Portfolio → Account &amp; Contribution Settings
    </FocusLink>
  );
}
