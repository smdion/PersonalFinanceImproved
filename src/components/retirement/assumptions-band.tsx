"use client";

/**
 * The assumptions band — Retirement Profiles phase 4 (the design plan's
 * §05, "UI and the play loop"). Sits directly above the Retirement
 * Projection chart so the household can "play" with the plan without the
 * multiple clicks back and forth to the Budget page's Retirement Profiles
 * tab that motivated this whole migration.
 *
 * Copies the Paycheck page's pattern exactly, per §05's explicit finding
 * that a new mechanism (an unsaved draft, a Play-toggle fork) wasn't
 * needed — the app already has one:
 *   - A selector that VIEWS a different profile without activating it
 *     (useEffectiveProfileId: Plan pin -> local selection -> global active)
 *   - The SAME shared padlock every profile surface uses (EditLockToggle,
 *     EDIT_LOCK_KEYS.profileEditLocked)
 *   - Unlocked -> click a chip -> writes straight to the profile, then
 *     invalidates. No draft, no dirty state, no Save button.
 *
 * Non-admin exploration (§08 "Non-admins can explore, not save") is
 * DEFERRED — out of scope for this pass. Non-admins see the same
 * always-locked, read-only summary the Retirement tab (Income section)
 * already gives them, with the disabled padlock explaining why (closing
 * the §05 consistency gap alongside Paycheck's — see edit-lock-toggle.tsx).
 *
 * Only chips with a REAL, currently-writable `retirement_settings` /
 * `retirement_profile_people` field are included. The design plan's §06
 * taxonomy also named a "Healthcare — pre-65 annual cost" chip; no such
 * column exists on either table (healthcare cost lives, if anywhere, as a
 * budget line item, not a retirement setting) — verified against the
 * schema before implementing, and dropped rather than invented. Routing
 * mode is similarly dropped: its UI doesn't currently exist as a chip-sized
 * control to link out to.
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
import {
  getAllStrategyKeys,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { buildSettingsPatch } from "@/components/retirement/sections/settings-patch";
import {
  decToWhole,
  wholeToDec,
} from "@/components/retirement/sections/helpers";
import type {
  Settings,
  PerPersonSettings,
  UpsertSettingsMutation,
} from "@/components/retirement/sections/types";

type ProfileListEntry = { id: number; name: string };

/** Inflation/Withdrawal-Rate/Raise chips were structurally identical
 *  (~16 lines each, same InlineEdit percent wiring) — code-review
 *  reuse/duplication finding, 2026-09-01. */
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
  onChange: (decValue: string) => void;
}) {
  return (
    <span className={chipCls}>
      <span className={labelCls}>{label}</span>
      <InlineEdit
        value={decToWhole(value)}
        onSave={(v) => onChange(wholeToDec(v))}
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
  /** Which profile is actually being shown right now — the resolved
   *  Plan-pin / local-selection / global-active id from
   *  useEffectiveProfileId, fed into computeProjection's own
   *  retirementProfileId override so the chart and the band always agree
   *  on which profile they're both looking at. */
  viewingProfileId: number | null;
  onViewingProfileChange: (id: number | null) => void;
  /** Whether the viewed profile is the household's globally-active one —
   *  drives the "(viewing — not active)" / "Make active" affordance. */
  activeProfileId: number | null;
  onActivate: (id: number) => void;
  /** From useEffectiveProfileId — "plan-pin" means a session Plan is
   *  overriding the local selector, matching Paycheck's own indicator. */
  effectiveSource: "plan-pin" | "user-selection" | "global-default";
  admin: boolean;
};

export function AssumptionsBand({
  settings,
  perPersonSettings,
  profiles,
  viewingProfileId,
  onViewingProfileChange,
  activeProfileId,
  onActivate,
  effectiveSource,
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
  // Same TypeScript inference gap retirement-profile-tab.tsx documents:
  // tRPC's inferred input uses the specific withdrawalStrategy enum union
  // and omits null from optional strategy fields; the Settings/
  // buildSettingsPatch layer mirrors the raw DB shape (string / string|null).
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
  const strategyKey = (settings.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyMeta = getStrategyMeta(strategyKey);
  const isMultiPerson = perPersonSettings && perPersonSettings.length > 1;

  const chipCls =
    "inline-flex items-center gap-1 rounded-md border border-subtle bg-surface-primary/60 px-2 py-1 text-caption";
  const labelCls = "text-faint";

  return (
    <div className="print:hidden mb-3 rounded-lg border bg-surface-primary/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-label font-semibold text-muted uppercase tracking-wider">
          Assumptions
        </span>
        {profiles.length > 1 ? (
          <select
            className="text-xs border rounded px-1.5 py-0.5 bg-surface-primary"
            value={viewingProfileId ?? ""}
            onChange={(e) => onViewingProfileChange(Number(e.target.value))}
            aria-label="Retirement profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium">
            {profiles.find((p) => p.id === profileId)?.name ?? "Current Plan"}
          </span>
        )}
        {effectiveSource === "plan-pin" ? (
          <span className="text-micro text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium">
            Active in this Plan
          </span>
        ) : profileId !== activeProfileId ? (
          <span className="text-caption text-muted font-medium">
            (viewing — not active)
            {admin && (
              <button
                type="button"
                onClick={() => onActivate(profileId)}
                className="ml-1 text-blue-600 hover:underline"
              >
                Make active
              </button>
            )}
          </span>
        ) : null}
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
            value={String(settings.endAge)}
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

        {strategyMeta.usesWithdrawalRate && (
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

        {strategyMeta.usesPostRetirementRaise && (
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

        <span className={chipCls}>
          <span className={labelCls}>Strategy</span>
          {editable ? (
            <select
              value={strategyKey}
              onChange={(e) =>
                upsertSettings.mutate(
                  buildSettingsPatch(settings, {
                    withdrawalStrategy: e.target
                      .value as WithdrawalStrategyType,
                  }),
                )
              }
              className="text-caption bg-transparent"
            >
              {getAllStrategyKeys().map((key) => (
                <option key={key} value={key}>
                  {getStrategyMeta(key).label}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium">{strategyMeta.label}</span>
          )}
        </span>

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
              value={String(Number(settings.rothBracketTarget ?? "0.12"))}
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
              {formatPercent(Number(settings.rothBracketTarget ?? "0.12"), 0)}
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
              : formatCurrency(Number(settings.socialSecurityMonthly))}
            {strategyExpanded ? " ▲" : " ▼"}
          </button>
        ) : null}
      </div>

      {strategyExpanded && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1.5 border-t">
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
                value={settings.socialSecurityMonthly}
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
              value={String(settings.ssStartAge)}
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
