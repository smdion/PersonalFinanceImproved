"use client";

/**
 * Admin edit of the household's high-income line, at or above which the employer match is
 * left out of the savings rate by default. Cleared, it uses the filing-status default.
 */
import { InlineEdit } from "@/components/ui/inline-edit";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { filingStatusLabel } from "@/lib/config/display-labels";
import type { HighIncomeLineBasis } from "@/lib/pure/paycheck/high-income-line";
import { HIGH_INCOME_LINE } from "@/lib/config/milestones";

function basisText(basis: HighIncomeLineBasis | null): string {
  if (basis === null) return "";
  if (basis === "people") return " (by household size — set a filing status)";
  return ` (${filingStatusLabel(basis)})`;
}

export function HighIncomeLineEdit() {
  const user = useUser();
  const { threshold, basis, defaultThreshold, setSaved } = useHighIncomeLine();
  if (threshold === undefined) return null;
  return (
    <span className="text-caption text-faint inline-flex items-center gap-1">
      High-income line
      <InlineEdit
        value={basis === null ? String(threshold) : ""}
        isEditable={isAdmin(user)}
        type="number"
        ariaLabel="High-income line"
        formatDisplay={() =>
          `${formatCurrency(threshold, 0)}${basisText(basis)}`
        }
        onSave={(raw) => {
          const n = Number(raw);
          setSaved(
            raw.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n,
          );
        }}
      />
      <HelpTip
        text={`Money Guy: at or above this household pay, the employer match stops counting toward the 25% savings rate. The default is ${formatCurrency(HIGH_INCOME_LINE.married, 0)} married filing jointly and ${formatCurrency(HIGH_INCOME_LINE.single, 0)} otherwise${defaultThreshold !== undefined && basis === null ? ` (${formatCurrency(defaultThreshold, 0)} for this household)` : ""}; clear it to go back to the default.`}
      />
    </span>
  );
}
