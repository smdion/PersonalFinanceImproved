"use client";

/**
 * Under an HSA account in "What you hold now": its uninvested cash and the
 * cash buffer the HSA-cash recommendation keeps — the household setting
 * (admins edit it here), else the year's HDHP minimum deductible for the
 * owner's coverage.
 */
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { SK_HSA_CASH_BUFFER } from "@/lib/constants/settings-keys";
import { resolveHsaCashBuffer } from "@/lib/pure/cash-positions";

export function HsaCashBuffer({
  ownerPersonId,
  uninvestedCash,
}: {
  ownerPersonId: number | null;
  uninvestedCash: number | null;
}) {
  const user = useUser();
  const { data } = useHouseholdIncomeSummary();
  const [setting, setSetting] = usePersistedSetting<number | null>(
    SK_HSA_CASH_BUFFER,
    null,
  );
  const buffer = resolveHsaCashBuffer(
    setting,
    data?.hsaBuffers ?? [],
    ownerPersonId,
  );
  return (
    <div className="text-caption text-faint mb-1 flex flex-wrap gap-x-3">
      {uninvestedCash !== null && (
        <span>Uninvested cash {formatCurrency(uninvestedCash, 0)}</span>
      )}
      <span className="inline-flex items-center gap-1">
        Cash buffer
        <InlineEdit
          value={setting === null ? "" : String(setting)}
          isEditable={isAdmin(user)}
          type="number"
          formatDisplay={() =>
            buffer === null
              ? "not set (coverage unknown)"
              : setting === null
                ? `${formatCurrency(buffer, 0)} (HDHP minimum deductible)`
                : formatCurrency(buffer, 0)
          }
          onSave={(raw) => {
            const n = Number(raw);
            setSetting(
              raw.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n,
            );
          }}
        />
      </span>
    </div>
  );
}
