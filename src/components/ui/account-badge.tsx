import { accountTextColor, accountBadgeBg } from "@/lib/utils/colors";

/**
 * Shared badge for account/category types (401k, IRA, HSA, Brokerage, ESPP, etc.).
 * Uses centralized colors from colors.ts for consistency across pages.
 */
export function AccountBadge({ type }: { type: string }) {
  const text = accountTextColor(type);
  const lightBg = accountBadgeBg(type);
  return (
    <span
      className={`text-caption inline-flex items-center rounded px-2 py-0.5 font-semibold tracking-wide uppercase ${lightBg} ${text}`}
    >
      {type}
    </span>
  );
}
