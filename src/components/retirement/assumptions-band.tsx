"use client";

/**
 * Assumptions band above the Retirement Projection chart: an active-profile selector, the shared
 * edit padlock, and chips that write straight to the profile (no draft, no Save). Non-admins see
 * it locked. Only fields with a writable `retirement_settings`/`retirement_profile_people` column.
 */

import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import {
  EditLockToggle,
  EDIT_LOCK_KEYS,
  useEditLock,
} from "@/components/ui/edit-lock-toggle";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import { StrategyChip } from "@/components/retirement/sections/strategy-picker";
import { buildSettingsPatch } from "@/components/retirement/sections/settings-patch";
import {
  decimalToWhole,
  rothTargetOf,
  wholeToDecimal,
} from "@/components/retirement/sections/helpers";
import type {
  Settings,
  PerPersonSettings,
  UpsertSettingsMutation,
} from "@/components/retirement/sections/types";

type ProfileListEntry = { id: number; name: string };

/** One percent chip (inflation, withdrawal rate, raise). */
function PercentChip({
  chipCls,
  labelCls,
  label,
  value,
  editable,
  onChange,
}: {
  chipCls: string;
  labelCls: string;
  label: ReactNode;
  /** Decimal fraction from settings (e.g. "0.035"), not a whole percent. */
  value: string;
  editable: boolean;
  /** Receives the new value as a decimal fraction, ready for buildSettingsPatch. */
  onChange: (decimalValue: string) => void;
}) {
  return (
    <span className={chipCls}>
      <span className={labelCls}>{label}</span>
      <InlineEdit
        value={decimalToWhole(value)}
        onSave={(v) => onChange(wholeToDecimal(v))}
        formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
        parseInput={(v) => v.replace(/[^0-9.]/g, "")}
        type="number"
        className="text-caption"
        isEditable={editable}
      />
    </span>
  );
}

type Props = {
  settings: Settings;
  perPersonSettings: PerPersonSettings;
  profiles: ProfileListEntry[];
  /** The active Retirement Profile — the one this page shows. */
  activeProfileId: number | null;
  /** Make another profile the active one (admin only — same as the header). */
  onActivate: (id: number) => void;
  admin: boolean;
};

export function AssumptionsBand({
  settings,
  perPersonSettings,
  profiles,
  activeProfileId,
  onActivate,
  admin,
}: Props) {
  const utils = trpc.useUtils();
  const [locked, toggleLock] = useEditLock(EDIT_LOCK_KEYS.profileEditLocked);
  const editable = admin && !locked;
  const [strategyExpanded, setStrategyExpanded] = useState(false);

  const invalidate = () => {
    utils.retirement.invalidate();
    utils.projection.invalidate();
  };
  const upsertSettingsRaw =
    trpc.retirement.retirementSettings.upsert.useMutation({
      onSuccess: invalidate,
    });
  // tRPC infers the strategy enum union and omits null from optional
  // strategy fields; buildSettingsPatch mirrors the raw DB shape (string /
  // string|null), as in retirement-profile-tab.tsx.
  const upsertSettings = upsertSettingsRaw as unknown as UpsertSettingsMutation; // eslint-disable-line no-restricted-syntax
  const upsertPerson =
    trpc.retirement.retirementProfilePeople.upsertPerson.useMutation({
      onSuccess: invalidate,
    });
  const upsertHouseholdFields =
    trpc.retirement.retirementProfilePeople.upsertHouseholdFields.useMutation({
      onSuccess: invalidate,
    });

  if (settings.profileId == null) return null;
  const profileId = settings.profileId;
  const strategyMeta = storedStrategyConfig(settings.withdrawalStrategy);
  const isMultiPerson = perPersonSettings && perPersonSettings.length > 1;

  const chipCls =
    "inline-flex items-center gap-1 rounded-md border border-subtle bg-surface-primary/60 px-2 py-1 text-caption";
  const labelCls = "text-faint";

  return (
    <div className="bg-surface-primary/40 mb-3 rounded-lg border px-3 py-2 print:hidden">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-label text-muted font-semibold tracking-wider uppercase">
          Assumptions
        </span>
        {profiles.length > 1 && admin ? (
          <select
            className="bg-surface-primary rounded border px-1.5 py-0.5 text-xs"
            value={activeProfileId ?? ""}
            onChange={(e) => onActivate(Number(e.target.value))}
            aria-label="Active retirement profile"
            title="Makes this the active Retirement profile everywhere"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium">
            {profiles.find((p) => p.id === profileId)?.name ??
              "Current Retirement"}
          </span>
        )}
        <div className="flex-1" />
        <EditLockToggle
          locked={locked}
          onToggle={toggleLock}
          disabled={!admin}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Retirement age(s) */}
        {isMultiPerson ? (
          perPersonSettings!.map((ps) => (
            <span key={ps.personId} className={chipCls}>
              <span className={labelCls}>{ps.name}</span>
              <InlineEdit
                value={String(ps.retirementAge)}
                onSave={(v) => {
                  const n = parseInt(v, 10);
                  if (isNaN(n)) return;
                  upsertPerson.mutate({
                    profileId,
                    personId: ps.personId,
                    retirementAge: n,
                  });
                }}
                type="number"
                className="text-caption"
                isEditable={editable}
              />
            </span>
          ))
        ) : (
          <span className={chipCls}>
            <span className={labelCls}>Retire</span>
            <InlineEdit
              value={String(settings.retirementAge)}
              onSave={(v) => {
                const n = parseInt(v, 10);
                if (isNaN(n)) return;
                upsertPerson.mutate({
                  profileId,
                  personId: settings.personId,
                  retirementAge: n,
                });
              }}
              type="number"
              className="text-caption"
              isEditable={editable}
            />
          </span>
        )}

        <span className={chipCls}>
          <span className={labelCls}>
            Through
            <HelpTip text="How long your money needs to last. Higher = more safety margin." />
          </span>
          <InlineEdit
            value={String(settings.ownEndAge)}
            onSave={(v) => {
              const n = parseInt(v, 10);
              if (isNaN(n)) return;
              upsertHouseholdFields.mutate({ profileId, endAge: n });
            }}
            type="number"
            className="text-caption"
            isEditable={editable}
          />
        </span>

        <PercentChip
          chipCls={chipCls}
          labelCls={labelCls}
          label="Inflation"
          value={settings.annualInflation}
          editable={editable}
          onChange={(v) =>
            upsertSettings.mutate(
              buildSettingsPatch(settings, { annualInflation: v }),
            )
          }
        />

        {strategyMeta?.usesWithdrawalRate && (
          <PercentChip
            chipCls={chipCls}
            labelCls={labelCls}
            label={
              strategyMeta.incomeSource === "budget"
                ? "Withdrawal Rate"
                : "Initial Rate"
            }
            value={settings.withdrawalRate}
            editable={editable}
            onChange={(v) =>
              upsertSettings.mutate(
                buildSettingsPatch(settings, { withdrawalRate: v }),
              )
            }
          />
        )}

        {strategyMeta?.usesPostRetirementRaise && (
          <PercentChip
            chipCls={chipCls}
            labelCls={labelCls}
            label="Raise"
            value={settings.postRetirementInflation ?? settings.annualInflation}
            editable={editable}
            onChange={(v) =>
              upsertSettings.mutate(
                buildSettingsPatch(settings, { postRetirementInflation: v }),
              )
            }
          />
        )}

        <StrategyChip
          chipCls={chipCls}
          labelCls={labelCls}
          settings={settings}
          upsertSettings={upsertSettings}
          editable={editable}
        />

        <span className={chipCls}>
          <span className={labelCls}>
            Bracket Ceiling
            <HelpTip
              text={
                settings.rothConversionTarget == null
                  ? "Fill traditional (pre-tax) withdrawals up to this bracket, then use Roth for the rest. Keeps taxable income in cheaper brackets. Also governs Roth conversions, since you haven't set a separate Conversion Target on the Taxes tab. Same setting as the Taxes tab's Bracket Ceiling."
                  : "Fill traditional (pre-tax) withdrawals up to this bracket, then use Roth for the rest. Keeps taxable income in cheaper brackets. Roth conversions use their own separate Conversion Target (set on the Taxes tab), not this. Same setting as the Taxes tab's Bracket Ceiling."
              }
            />
          </span>
          {editable ? (
            <select
              aria-label="Bracket ceiling"
              value={String(rothTargetOf(settings.rothBracketTarget))}
              onChange={(e) =>
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    rothBracketTarget: e.target.value,
                  }),
                )
              }
              className="text-caption bg-transparent"
            >
              <option value="0.1">10%</option>
              <option value="0.12">12%</option>
              <option value="0.22">22%</option>
              <option value="0.24">24%</option>
              <option value="0.32">32%</option>
            </select>
          ) : (
            <span className="font-medium">
              {formatPercent(rothTargetOf(settings.rothBracketTarget), 0)}
            </span>
          )}
        </span>

        {Number(settings.socialSecurityMonthly) > 0 ||
        perPersonSettings?.some((p) => Number(p.socialSecurityMonthly) > 0) ? (
          <button
            type="button"
            onClick={() => setStrategyExpanded((v) => !v)}
            className={`${chipCls} hover:bg-surface-elevated`}
          >
            SS{" "}
            {isMultiPerson
              ? "(per person)"
              : formatCurrency(
                  Number(
                    perPersonSettings?.[0]?.socialSecurityMonthly ??
                      settings.socialSecurityMonthly,
                  ),
                )}
            {strategyExpanded ? " ▲" : " ▼"}
          </button>
        ) : null}
      </div>

      {strategyExpanded && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t pt-1.5">
          {isMultiPerson ? (
            perPersonSettings!.map((ps) => (
              <span key={ps.personId} className={chipCls}>
                <span className={labelCls}>{ps.name}&apos;s SS</span>
                <InlineEdit
                  value={ps.socialSecurityMonthly}
                  onSave={(v) => {
                    const n = parseFloat(v);
                    if (isNaN(n) || n < 0) return;
                    upsertPerson.mutate({
                      profileId,
                      personId: ps.personId,
                      socialSecurityMonthly: String(n),
                    });
                  }}
                  formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                  parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                  type="number"
                  className="text-caption"
                  isEditable={editable}
                />
              </span>
            ))
          ) : (
            <span className={chipCls}>
              <span className={labelCls}>SS Benefit</span>
              <InlineEdit
                value={
                  perPersonSettings?.[0]?.socialSecurityMonthly ??
                  settings.socialSecurityMonthly
                }
                onSave={(v) => {
                  const n = parseFloat(v);
                  if (isNaN(n) || n < 0) return;
                  upsertPerson.mutate({
                    profileId,
                    personId: settings.personId,
                    socialSecurityMonthly: String(n),
                  });
                }}
                formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-caption"
                isEditable={editable}
              />
            </span>
          )}
          <span className={chipCls}>
            <span className={labelCls}>SS Start Age</span>
            <InlineEdit
              value={String(
                !isMultiPerson && perPersonSettings?.[0]
                  ? perPersonSettings[0].ssStartAge
                  : settings.ssStartAge,
              )}
              onSave={(v) => {
                const n = parseInt(v, 10);
                if (isNaN(n) || n < 62 || n > 70) return;
                upsertHouseholdFields.mutate({ profileId, ssStartAge: n });
              }}
              type="number"
              className="text-caption"
              isEditable={editable}
            />
          </span>
        </div>
      )}
    </div>
  );
}
