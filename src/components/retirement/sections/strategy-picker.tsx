/**
 * The withdrawal strategy pickers: the Retirement budget and strategy
 * section's and the assumptions band's chip. A stored key naming no
 * current strategy shows nothing selected and a note naming it.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import {
  getAllStrategyKeys,
  getStrategyMeta,
} from "@/lib/config/withdrawal-strategies";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import { recommendWithdrawalStrategy } from "@/lib/pure/retirement/withdrawal-strategy-recommendation";
import type { Settings, UpsertSettingsMutation, IsEditable } from "./types";
import { buildSettingsPatch } from "./settings-patch";

/** A restored backup can carry a strategy key Ledgr doesn't have. */
function UnknownStrategyNote({ storedKey }: { storedKey: string }) {
  return (
    <span className="text-caption text-amber-600">
      Your saved strategy (<code>{storedKey}</code>) isn&apos;t one Ledgr has
      now; pick one.
    </span>
  );
}

/** Saves the picked strategy through the settings upsert. */
function saveStrategy(
  upsertSettings: UpsertSettingsMutation,
  settings: Settings,
  picked: string,
) {
  const key = getAllStrategyKeys().find((k) => k === picked);
  if (key)
    upsertSettings.mutate(
      buildSettingsPatch(settings, { withdrawalStrategy: key }),
    );
}

type Props = {
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
  /** The accumulation phase reads a budget profile. */
  hasBudgetLink: boolean;
  isEditable: IsEditable;
};

export function StrategyPickerSection({
  settings,
  upsertSettings,
  hasBudgetLink,
  isEditable,
}: Props) {
  const strategyMeta = storedStrategyConfig(settings.withdrawalStrategy);
  const rec = recommendWithdrawalStrategy({
    retirementHorizonYears: settings.endAge - settings.retirementAge,
    hasBudgetLink,
    hasSocialSecurity: Number(settings.socialSecurityMonthly) > 0,
    mostlyTaxAdvantaged: false,
  });
  return (
    <div className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-3">
      <div className="col-span-2">
        <span className="text-muted">
          Strategy
          <HelpTip text="How annual spending is determined during retirement. Fixed Real: perfectly predictable income that never changes based on market performance. The others decide each year by their own rule — some adjust after market moves, Spending Decline steps down on a schedule — which protects against depletion (higher success rates) but means your income varies year to year. Every strategy is measured against your Retirement budget. The more a strategy self-corrects, the higher its success rate but the less stable your income. See Full Methodology for detailed guidance on when to use each strategy." />
        </span>
        <div className="font-medium">
          <select
            aria-label="Strategy"
            value={strategyMeta ? settings.withdrawalStrategy : ""}
            onChange={(e) => {
              saveStrategy(upsertSettings, settings, e.target.value);
            }}
            disabled={!isEditable}
            className="w-full rounded border px-1.5 py-0.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {!strategyMeta && <option value="" disabled />}
            {getAllStrategyKeys().map((key) => {
              const isRecommended = key === rec.strategy;
              return (
                <option key={key} value={key}>
                  {isRecommended ? "★ " : ""}
                  {getStrategyMeta(key).label}
                  {isRecommended ? " — Recommended" : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>
      <div>
        {strategyMeta ? (
          <span className="text-muted text-caption">
            {strategyMeta.description}
          </span>
        ) : (
          <UnknownStrategyNote storedKey={settings.withdrawalStrategy} />
        )}
      </div>
    </div>
  );
}

/** The assumptions band's strategy chip: a select while editable, else the
 *  strategy's label. */
export function StrategyChip({
  chipCls,
  labelCls,
  settings,
  upsertSettings,
  editable,
}: {
  chipCls: string;
  labelCls: string;
  settings: Settings;
  upsertSettings: UpsertSettingsMutation;
  editable: boolean;
}) {
  const strategyMeta = storedStrategyConfig(settings.withdrawalStrategy);
  return (
    <span className={chipCls}>
      <span className={labelCls}>Strategy</span>
      {editable ? (
        <select
          aria-label="Strategy"
          value={strategyMeta ? settings.withdrawalStrategy : ""}
          onChange={(e) =>
            saveStrategy(upsertSettings, settings, e.target.value)
          }
          className="text-caption bg-transparent"
        >
          {!strategyMeta && <option value="" disabled />}
          {getAllStrategyKeys().map((key) => (
            <option key={key} value={key}>
              {getStrategyMeta(key).label}
            </option>
          ))}
        </select>
      ) : (
        strategyMeta && (
          <span className="font-medium">{strategyMeta.label}</span>
        )
      )}
      {!strategyMeta && (
        <UnknownStrategyNote storedKey={settings.withdrawalStrategy} />
      )}
    </span>
  );
}
