import Link from "next/link";
import { LINK_CLASS } from "@/components/ui/settings-link";

/** `?section=` value that opens Portfolio's Account & Contribution Settings. */
export const PORTFOLIO_ACCOUNTS_SECTION = "accounts";
export const PORTFOLIO_ACCOUNTS_ANCHOR = "account-settings";

/** Link to Portfolio → Account & Contribution Settings (opened and scrolled to). */
export function PortfolioAccountsLink({
  className = LINK_CLASS,
}: {
  className?: string;
}) {
  return (
    <Link
      href={`/portfolio?section=${PORTFOLIO_ACCOUNTS_SECTION}#${PORTFOLIO_ACCOUNTS_ANCHOR}`}
      className={className}
    >
      Portfolio → Account &amp; Contribution Settings
    </Link>
  );
}
