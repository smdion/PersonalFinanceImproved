"use client";

/**
 * Contribution Profile compare view (R20) — accounts as rows, profiles as
 * columns, each cell showing that profile's own active value for the
 * account, or "Not set" when the profile has no value for it at all. A
 * standing audit tool, not just a pre-swap warning: lets you sanity-check
 * coverage across every profile at once, not one at a time — "Not set" is
 * a real gap to flag, not a benign fallback, since accounts carry no value
 * of their own (see applyContribActiveFields).
 *
 * Kept as its own file rather than folded into contribution-profile-manager.tsx
 * (already ~1,457 lines, near the 1,500-line pnpm check:file-size warn
 * threshold) — see that file's `compareData` query, the single shared data
 * source this and the swap-time diff (R20 phase A) both consume.
 *
 * Cell display logic mirrors ProfileDetailPanel's per-account row in
 * contribution-profile-manager.tsx (hasActiveFields/value, amber highlight
 * when set, DISABLED badge when isActive:false) — same resolution rule,
 * just applied per cell instead of per row-of-one-profile.
 */
import { trpc } from "@/lib/trpc";

type ActiveFields = {
  contributionValue?: string | number;
  contributionMethod?: string;
  isActive?: boolean;
} | null;

function cellLabel(activeFields: ActiveFields) {
  const hasActiveFields = activeFields != null;
  const isDisabled = activeFields?.isActive === false;
  const methodSuffix =
    activeFields?.contributionMethod === "percent_of_salary" ? "%" : "";
  const value = activeFields?.contributionValue;

  return { hasActiveFields, isDisabled, value, methodSuffix };
}

export function ContributionProfileCompare() {
  const { data, isLoading } = trpc.contributionProfile.compareData.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="animate-pulse h-8 bg-surface-elevated rounded" />
        <div className="animate-pulse h-64 bg-surface-elevated rounded" />
      </div>
    );
  }

  if (!data || data.profiles.length === 0) {
    return <p className="text-caption text-faint italic">No profiles yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-strong">
            <th className="text-left py-2 pl-4 pr-3 text-muted font-medium sticky left-0 bg-surface-primary">
              Account
            </th>
            {data.profiles.map((p) => (
              <th
                key={p.id}
                className="text-right py-2 px-3 text-muted font-medium whitespace-nowrap"
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((account, rowIdx) => (
            <tr
              key={account.id}
              className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
              }`}
            >
              <td className="py-1.5 pl-4 pr-3 text-secondary sticky left-0 bg-inherit whitespace-nowrap">
                {account.accountName}
              </td>
              {data.profiles.map((p) => {
                const activeFields = (p.accountActiveFields[
                  String(account.id)
                ] ?? null) as ActiveFields;
                const { hasActiveFields, isDisabled, value, methodSuffix } =
                  cellLabel(activeFields);
                return (
                  <td
                    key={p.id}
                    className={`py-1.5 px-3 text-right font-mono whitespace-nowrap ${
                      hasActiveFields && !isDisabled
                        ? "text-amber-600 font-medium"
                        : "text-faint"
                    }`}
                  >
                    {isDisabled ? (
                      <span className="text-micro px-1 py-0.5 rounded bg-surface-strong text-muted font-semibold">
                        DISABLED
                      </span>
                    ) : hasActiveFields ? (
                      `${value}${methodSuffix}`
                    ) : (
                      <span className="italic">Not set</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
