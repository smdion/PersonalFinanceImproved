"use client";

/**
 * Settings → Reference Data → IRS Limits: how fast contribution limits are
 * assumed to grow in projected years past the newest tax year entered. A
 * projection assumption, not a published figure, so it sits under the
 * yearly limits rather than in them (one value, not per year).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";
import {
  IRS_LIMIT_GROWTH_RATE,
  IRS_LIMIT_GROWTH_RATE_MAX,
} from "@/lib/constants";
import { SK_IRS_LIMIT_GROWTH_RATE } from "@/lib/constants/settings-keys";

/** Sanity bounds for the editable IRS-limit growth rate. Also enforced
 *  server-side (build-engine-payload.ts clamps on read). */
const IRS_GROWTH_MIN = 0;
const IRS_GROWTH_MAX = IRS_LIMIT_GROWTH_RATE_MAX;

export function IrsLimitGrowthSetting() {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      utils.settings.appSettings.list.invalidate();
      // This value feeds every projection — refetch them so /retirement
      // reflects the new rate without a hard reload.
      utils.projection.invalidate();
      utils.retirement.invalidate();
      setError(null);
    },
  });
  const [error, setError] = useState<string | null>(null);
  const row = appSettings?.find((s) => s.key === SK_IRS_LIMIT_GROWTH_RATE);
  const rate =
    row && Number.isFinite(Number(row.value))
      ? Number(row.value)
      : IRS_LIMIT_GROWTH_RATE;

  const handleSave = (rawPercent: string) => {
    const pct = parseFloat(rawPercent);
    if (isNaN(pct)) {
      setError("Enter a number");
      return;
    }
    const next = pct / 100;
    if (next < IRS_GROWTH_MIN || next > IRS_GROWTH_MAX) {
      setError(
        `Must be between ${IRS_GROWTH_MIN * 100}% and ${IRS_GROWTH_MAX * 100}%`,
      );
      return;
    }
    setError(null);
    // Back to the engine default → delete the row so the constant applies
    // and the "(default)" tag returns. `upsert` with a null value deletes.
    if (Math.abs(next - IRS_LIMIT_GROWTH_RATE) < 1e-9) {
      if (row)
        upsertSetting.mutate({ key: SK_IRS_LIMIT_GROWTH_RATE, value: null });
      return;
    }
    upsertSetting.mutate({ key: SK_IRS_LIMIT_GROWTH_RATE, value: next });
  };

  return (
    <div className="border-subtle bg-surface-sunken mt-6 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-secondary text-sm font-medium">
            Growth in future years
          </div>
          <div className="text-faint text-xs">
            Projections past the newest year above assume these limits rise this
            much each year (a planning assumption, not a published figure).
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {admin ? (
              <InlineEdit
                value={(rate * 100).toFixed(2).replace(/\.?0+$/, "")}
                onSave={handleSave}
                formatDisplay={(v) => formatPercent(parseFloat(v) / 100, 1)}
              />
            ) : (
              <span className="text-primary text-sm">
                {formatPercent(rate, 1)}
              </span>
            )}
            {!row && <span className="text-faint text-xs">(default)</span>}
          </div>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
