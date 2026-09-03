/**
 * Healthcare Cost Awareness panel. Holds the IRMAA awareness toggle, ACA
 * subsidy awareness toggle,
 * and conditional household-size selector.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import type { Settings, UpsertSettingsMutation, IsEditable } from "./types";
import { buildSettingsPatch } from "./settings-patch";

type Props = {
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
  isEditable: IsEditable;
};

export function HealthcareSection({
  settings,
  upsertSettings,
  isEditable,
}: Props) {
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Healthcare
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted">
            IRMAA (65+)
            <HelpTip text="Medicare Part B+D surcharges triggered by MAGI cliffs. Crossing a cliff by $1 costs $1,000-$6,900+/year per person. Engine warns when Roth conversions or withdrawals approach a cliff." />
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                if (!settings) return;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    enableIrmaaAwareness: !(
                      settings.enableIrmaaAwareness ?? false
                    ),
                  }),
                );
              }}
              disabled={!isEditable}
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                (settings?.enableIrmaaAwareness ?? false)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.enableIrmaaAwareness ?? false) ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div>
          <span className="text-muted">
            ACA Subsidy (Pre-65)
            <HelpTip text="ACA health insurance subsidy cliff. Going $1 over 400% FPL costs $15,000-$25,000+ in lost subsidies. Engine warns when MAGI approaches the cliff and prefers Roth/HSA withdrawals." />
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                if (!settings) return;
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    enableAcaAwareness: !(settings.enableAcaAwareness ?? false),
                  }),
                );
              }}
              disabled={!isEditable}
              className={`rounded px-2 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                (settings?.enableAcaAwareness ?? false)
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {(settings?.enableAcaAwareness ?? false) ? "On" : "Off"}
            </button>
          </div>
        </div>
        {(settings?.enableAcaAwareness ?? false) && (
          <div>
            <span className="text-muted">Household Size</span>
            <div className="font-medium">
              <select
                value={String(settings?.householdSize ?? 2)}
                onChange={(e) => {
                  if (!settings) return;
                  upsertSettings.mutate(
                    buildSettingsPatch(settings, {
                      householdSize: parseInt(e.target.value, 10),
                    }),
                  );
                }}
                disabled={!isEditable}
                className="rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
