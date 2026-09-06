"use client";

/**
 * Account-order reorder control shared by the Retirement page's per-session
 * Withdrawal Routing panel (cards/projection/decumulation-config.tsx) and the
 * Retirement Profile's persisted default in Taxes in Retirement
 * (retirement/sections/taxes.tsx). Both edit the SAME `withdrawalOrder`
 * array the engine reads — the session panel writes a transient override,
 * the settings panel writes the saved household default.
 */
import { AccountBadge } from "@/components/ui/account-badge";
import type { AccountCategory } from "@/lib/calculators/types";

export function WithdrawalOrderEditor({
  order,
  onChange,
  filter,
  disabled,
}: {
  order: AccountCategory[];
  onChange: (order: AccountCategory[]) => void;
  /** When set, only these categories are shown and reordered — used by
   *  bracket_filling's "Traditional Account Order" sub-control, which edits
   *  the SAME underlying `withdrawalOrder` waterfall's full editor writes
   *  (single source of truth — the engine's Phase 1 loop reads
   *  `withdrawalOrder` filtered to Traditional-preference categories
   *  regardless of which UI wrote it), just restricted to the subset that
   *  actually affects bracket_filling. A swap permutes only the filtered
   *  categories' OCCUPANTS — every other category (brokerage/HSA) keeps its
   *  exact position in the full array. Omitted ⇒ the unrestricted
   *  full-order editor. */
  filter?: AccountCategory[];
  disabled?: boolean;
}) {
  const filterSet = filter ? new Set(filter) : null;
  const visible = filterSet ? order.filter((c) => filterSet.has(c)) : order;

  function swapWithPrevious(idx: number) {
    if (disabled) return;
    if (!filterSet) {
      const next = [...order];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      onChange(next);
      return;
    }
    // Filtered mode: find where these two categories actually sit in the
    // FULL array (not necessarily adjacent there — an unfiltered category
    // may sit between them) and swap only those two slots.
    const a = visible[idx - 1]!;
    const b = visible[idx]!;
    const posA = order.indexOf(a);
    const posB = order.indexOf(b);
    const next = [...order];
    next[posA] = b;
    next[posB] = a;
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1">
      {visible.map((cat, idx) => (
        <span key={cat} className="flex items-center gap-0.5">
          {idx > 0 && <span className="text-faint mx-0.5">&rarr;</span>}
          <AccountBadge type={cat} />
          {idx > 0 && (
            <button
              type="button"
              onClick={() => swapWithPrevious(idx)}
              disabled={disabled}
              className="text-faint p-0.5 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              title={`Move ${cat} left`}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
