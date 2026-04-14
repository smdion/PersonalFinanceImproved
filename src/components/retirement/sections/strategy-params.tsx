/**
 * Strategy-specific parameter controls — extracted from the Decumulation Plan
 * block in retirement-content.tsx in PR 8/3a of the v0.5.2 file-split
 * refactor. Pure relocation — no behavior changes.
 *
 * Data-driven from the withdrawal strategy registry: given the active
 * strategy, we look up its `paramFields` (boolean / number / percent / the
 * special rollingYears variant) and render the matching editor with a
 * registry-defined db-column map. Previously lived as an IIFE inside the
 * Decumulation Plan JSX — now a sibling sub-component so Decumulation's
 * orchestrator stays compact.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import {
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { formatPercent } from "@/lib/utils/format";
import type { Settings, UpsertSettingsMutation } from "./_types";

type Props = {
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
};

export function StrategyParamsSection({ settings, upsertSettings }: Props) {
  const strategyKey = (settings?.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const meta = getStrategyMeta(strategyKey);
  if (meta.paramFields.length === 0) return null;

  // Map registry param keys to DB column names for reading/writing
  const paramToDbColumn: Record<string, string> = {
    // GK
    upperGuardrail: "gkUpperGuardrail",
    lowerGuardrail: "gkLowerGuardrail",
    increasePercent: "gkIncreasePct",
    decreasePercent: "gkDecreasePct",
    skipInflationAfterLoss: "gkSkipInflationAfterLoss",
    // Spending Decline
    annualDeclineRate: "sdAnnualDeclineRate",
    // Constant Percentage
    withdrawalPercent:
      strategyKey === "constant_percentage"
        ? "cpWithdrawalPercent"
        : strategyKey === "endowment"
          ? "enWithdrawalPercent"
          : "cpWithdrawalPercent",
    floorPercent:
      strategyKey === "constant_percentage"
        ? "cpFloorPercent"
        : strategyKey === "endowment"
          ? "enFloorPercent"
          : strategyKey === "vanguard_dynamic"
            ? "vdFloorPercent"
            : "cpFloorPercent",
    // Endowment
    rollingYears: "enRollingYears",
    // Vanguard Dynamic
    basePercent: "vdBasePercent",
    ceilingPercent: "vdCeilingPercent",
    // RMD
    rmdMultiplier: "rmdMultiplier",
  };

  // Partition fields into layout items: grouped pairs or standalone
  type LayoutItem =
    | {
        kind: "standalone";
        field: (typeof meta.paramFields)[number];
      }
    | {
        kind: "group";
        groupName: string;
        fields: (typeof meta.paramFields)[number][];
      };
  const layoutItems: LayoutItem[] = [];
  const seenGroups = new Set<string>();
  for (const field of meta.paramFields) {
    if (field.group) {
      if (seenGroups.has(field.group)) continue;
      seenGroups.add(field.group);
      const grouped = meta.paramFields.filter((f) => f.group === field.group);
      layoutItems.push({
        kind: "group",
        groupName: field.group,
        fields: grouped,
      });
    } else {
      layoutItems.push({ kind: "standalone", field });
    }
  }

  const renderField = (field: (typeof meta.paramFields)[number]) => {
    const dbCol = paramToDbColumn[field.key];
    if (!dbCol || !settings) return null;
    const currentVal = (settings as Record<string, unknown>)[dbCol];

    if (field.type === "boolean") {
      const boolVal =
        currentVal != null ? Boolean(currentVal) : Boolean(field.default);
      return (
        <div key={field.key}>
          <span className="text-muted">
            {field.label}
            {field.tooltip && <HelpTip text={field.tooltip} />}
          </span>
          <div className="font-medium">
            <button
              onClick={() => {
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  [dbCol]: !boolVal,
                });
              }}
              className={`text-sm px-2 py-0.5 rounded ${
                boolVal
                  ? "bg-green-100 text-green-700"
                  : "bg-surface-elevated text-muted"
              }`}
            >
              {boolVal ? "On" : "Off"}
            </button>
          </div>
        </div>
      );
    }

    if (field.type === "number" && field.key === "rollingYears") {
      const numVal =
        currentVal != null ? Number(currentVal) : Number(field.default);
      return (
        <div key={field.key}>
          <span className="text-muted">
            {field.label}
            {field.tooltip && <HelpTip text={field.tooltip} />}
          </span>
          <div className="font-medium">
            <select
              value={String(numVal)}
              onChange={(e) => {
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  [dbCol]: Number(e.target.value),
                });
              }}
              className="text-sm border rounded px-1.5 py-0.5"
            >
              {Array.from(
                {
                  length:
                    ((field.max ?? 20) - (field.min ?? 3)) / (field.step ?? 1) +
                    1,
                },
                (_, i) => {
                  const v = (field.min ?? 3) + i * (field.step ?? 1);
                  return (
                    <option key={v} value={String(v)}>
                      {v} years
                    </option>
                  );
                },
              )}
            </select>
          </div>
        </div>
      );
    }

    if (field.type === "number") {
      const numVal =
        currentVal != null ? Number(currentVal) : Number(field.default);
      return (
        <div key={field.key}>
          <span className="text-muted">
            {field.label}
            {field.tooltip && <HelpTip text={field.tooltip} />}
          </span>
          <div className="font-medium">
            <select
              value={String(numVal)}
              onChange={(e) => {
                upsertSettings.mutate({
                  personId: settings.personId,
                  retirementAge: settings.retirementAge,
                  endAge: settings.endAge,
                  returnAfterRetirement: settings.returnAfterRetirement,
                  annualInflation: settings.annualInflation,
                  salaryAnnualIncrease: settings.salaryAnnualIncrease,
                  [dbCol]: e.target.value,
                });
              }}
              className="text-sm border rounded px-1.5 py-0.5"
            >
              {Array.from(
                {
                  length:
                    Math.round(
                      ((field.max ?? 3) - (field.min ?? 0.5)) /
                        (field.step ?? 0.1),
                    ) + 1,
                },
                (_, i) => {
                  const v = (field.min ?? 0.5) + i * (field.step ?? 0.1);
                  const rounded = Math.round(v * 100) / 100;
                  return (
                    <option key={rounded} value={String(rounded)}>
                      {rounded}x
                    </option>
                  );
                },
              )}
            </select>
          </div>
        </div>
      );
    }

    // type === 'percent'
    const pctVal =
      currentVal != null ? Number(currentVal) : Number(field.default);
    return (
      <div key={field.key}>
        <span className="text-muted">
          {field.label}
          {field.tooltip && <HelpTip text={field.tooltip} />}
        </span>
        <div className="font-medium">
          <select
            value={String(pctVal)}
            onChange={(e) => {
              upsertSettings.mutate({
                personId: settings.personId,
                retirementAge: settings.retirementAge,
                endAge: settings.endAge,
                returnAfterRetirement: settings.returnAfterRetirement,
                annualInflation: settings.annualInflation,
                salaryAnnualIncrease: settings.salaryAnnualIncrease,
                [dbCol]: e.target.value,
              });
            }}
            className="text-sm border rounded px-1.5 py-0.5"
          >
            {Array.from(
              {
                length:
                  Math.round(
                    ((field.max ?? 1) - (field.min ?? 0)) /
                      (field.step ?? 0.01),
                  ) + 1,
              },
              (_, i) => {
                const v = (field.min ?? 0) + i * (field.step ?? 0.01);
                const rounded = Math.round(v * 1000) / 1000;
                return (
                  <option key={rounded} value={String(rounded)}>
                    {formatPercent(rounded, 1)}
                  </option>
                );
              },
            )}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
      {layoutItems.map((item) => {
        if (item.kind === "group") {
          return item.fields.map((f) => renderField(f));
        }
        return renderField(item.field);
      })}
    </div>
  );
}
