/**
 * Timeline section — extracted from retirement-content.tsx in PR 8/1 of the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes. Shows
 * per-person retirement ages (multi-person households) or a single retirement
 * age plus the shared Plan-Through end age. Lives in the left column of the
 * Timeline+Income sunken box; this component only renders the Timeline inner
 * block, keeping the outer wrapper at the call site so Income can sit next
 * to it inside the same rounded container.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import type { Settings, PerPersonSettings } from "./_types";

type Props = {
  settings: Settings;
  perPersonSettings: PerPersonSettings;
  handlePerPersonRetirementAge: (personId: number, newAge: number) => void;
  handleRetirementSettingUpdate: (field: string, value: string) => void;
};

export function TimelineSection({
  settings,
  perPersonSettings,
  handlePerPersonRetirementAge,
  handleRetirementSettingUpdate,
}: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Timeline
        </h4>
        <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
          Baseline + Simulation
        </span>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        {perPersonSettings && perPersonSettings.length > 1 ? (
          <>
            {perPersonSettings.map((ps) => (
              <div key={ps.personId}>
                <span className="text-muted">
                  {ps.name}&apos;s Retirement Age
                </span>
                <div className="font-medium flex items-baseline gap-1">
                  <InlineEdit
                    value={String(ps.retirementAge)}
                    onSave={(v) =>
                      handlePerPersonRetirementAge(ps.personId, parseInt(v, 10))
                    }
                    type="number"
                    className="text-sm"
                    editable={!!settings}
                  />
                  <span className="text-[10px] text-faint">
                    (now {new Date().getFullYear() - ps.birthYear})
                  </span>
                </div>
              </div>
            ))}
            <div>
              <span className="text-muted">Household Retirement</span>
              <div className="font-medium text-blue-600">
                {Math.max(...perPersonSettings.map((p) => p.retirementAge))}
                <span className="text-[10px] text-faint font-normal ml-1">
                  when last person retires
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
                editable={!!settings}
              />
            </div>
          </div>
        )}
        <div>
          <span className="text-muted">
            Plan Through
            <HelpTip text="How long your money needs to last. Higher = more safety margin." />
          </span>
          <div className="font-medium flex items-baseline gap-1">
            <InlineEdit
              value={String(settings.endAge)}
              onSave={(v) => handleRetirementSettingUpdate("endAge", v)}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
