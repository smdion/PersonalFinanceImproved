/**
 * Timeline section: per-person (or single) retirement ages plus the shared Plan-Through end age.
 * Renders only the inner block; the call site owns the wrapper it shares with Income.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Toggle } from "@/components/ui/toggle";
import type { Settings, PerPersonSettings, IsEditable } from "./types";

type Props = {
  settings: Settings;
  currentYear: number;
  perPersonSettings: PerPersonSettings;
  handlePerPersonRetirementAge: (personId: number, newAge: number) => void;
  handlePerPersonRuleOf55Override: (
    personId: number,
    ruleOf55Override: boolean,
  ) => void;
  handleRetirementSettingUpdate: (field: string, value: string) => void;
  handleGapYearSetting: (patch: Partial<Settings>) => void;
  isEditable: IsEditable;
};

export function TimelineSection({
  settings,
  currentYear,
  perPersonSettings,
  handlePerPersonRetirementAge,
  handlePerPersonRuleOf55Override,
  handleRetirementSettingUpdate,
  handleGapYearSetting,
  isEditable,
}: Props) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Timeline
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        {perPersonSettings && perPersonSettings.length > 1 ? (
          <>
            {perPersonSettings.map((ps) => (
              <div key={ps.personId}>
                <span className="text-muted">
                  {ps.name}&apos;s Retirement Age
                </span>
                <div className="flex items-baseline gap-1 font-medium">
                  <InlineEdit
                    value={String(ps.retirementAge)}
                    onSave={(v) =>
                      handlePerPersonRetirementAge(ps.personId, parseInt(v, 10))
                    }
                    type="number"
                    className="text-sm"
                    isEditable={isEditable}
                  />
                  <span className="text-caption text-faint">
                    (now {currentYear - ps.birthYear})
                  </span>
                </div>
                <div className="mt-1">
                  <Toggle
                    isChecked={ps.ruleOf55Override}
                    onChange={(checked) =>
                      handlePerPersonRuleOf55Override(ps.personId, checked)
                    }
                    label="Rule of 55 eligible"
                    size="xs"
                    disabled={!isEditable}
                    title="Turn off to forecast what happens if this person won't qualify for Rule of 55 (e.g. not at a qualifying job when they retire)"
                  />
                </div>
              </div>
            ))}
            <div>
              <span className="text-muted">Withdrawals start</span>
              <div className="font-medium text-blue-600">
                {settings.retirementYear}
                <span className="text-caption text-faint ml-1 font-normal">
                  when the last person with a job retires
                </span>
              </div>
            </div>
          </>
        ) : (
          <div>
            <span className="text-muted">
              Retirement Age
              <HelpTip text="When contributions stop and withdrawals begin." />
            </span>
            <div className="font-medium">
              <InlineEdit
                value={String(settings.retirementAge)}
                onSave={(v) =>
                  handleRetirementSettingUpdate("retirementAge", v)
                }
                type="number"
                className="text-sm"
                isEditable={isEditable}
              />
            </div>
          </div>
        )}
        <div>
          <span className="text-muted">
            Projection Through
            <HelpTip text="How long your money needs to last. Higher = more safety margin." />
          </span>
          <div className="flex items-baseline gap-1 font-medium">
            <InlineEdit
              value={String(settings.ownEndAge)}
              onSave={(v) => handleRetirementSettingUpdate("endAge", v)}
              type="number"
              className="text-sm"
              isEditable={isEditable}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 border-t pt-2 text-sm">
        <span className="text-muted">
          Years one paycheck is gone
          <HelpTip text="Years someone with a job has stopped before everyone retires: one person retired first, or a job ended early. Withdrawals for good haven't started yet. The projection marks these years in the Phase column; hover one to see the money." />
        </span>
        <div className="mt-1 flex flex-col gap-1">
          <Toggle
            isChecked={!settings.gapYearStopSaving}
            onChange={(checked) =>
              handleGapYearSetting({ gapYearStopSaving: !checked })
            }
            label="Keep saving as planned"
            size="xs"
            disabled={!isEditable}
            title="Off: nobody contributes in these years, employer match included, so pay goes to spending first."
          />
          <Toggle
            isChecked={settings.gapYearDraws}
            onChange={(checked) =>
              handleGapYearSetting({ gapYearDraws: checked })
            }
            label="Withdraw what pay doesn't cover"
            size="xs"
            disabled={!isEditable}
            title="Off: nothing comes out of the accounts in these years, and the projection spends only what's coming in."
          />
        </div>
      </div>
    </div>
  );
}
