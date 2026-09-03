/**
 * Social Security settings panel. The upsertSettings mutation passes
 * through as a prop so the parent keeps owning the optimistic-update glue.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import type {
  Settings,
  PerPersonSettings,
  UpsertProfilePersonMutation,
  UpsertProfileHouseholdFieldsMutation,
  IsEditable,
} from "./types";

type Props = {
  settings: Settings;
  perPersonSettings: PerPersonSettings;
  /** SS Benefit is genuinely per-person — writes `retirement_profile_people`
   *  directly for whichever person the chip belongs to. */
  upsertPerson: UpsertProfilePersonMutation;
  /** SS Start Age renders as ONE household-wide control regardless of
   *  person count, but its read source is per-person storage — fans out
   *  server-side. See retirementProfilePeople.upsertHouseholdFields. */
  upsertHouseholdFields: UpsertProfileHouseholdFieldsMutation;
  isEditable: IsEditable;
};

export function SocialSecuritySection({
  settings,
  perPersonSettings,
  upsertPerson,
  upsertHouseholdFields,
  isEditable,
}: Props) {
  if (settings.profileId == null) return null;
  const profileId = settings.profileId;
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
          Social Security
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        {perPersonSettings && perPersonSettings.length > 1 ? (
          perPersonSettings.map((ps) => (
            <div key={ps.personId}>
              <span className="text-muted">
                {ps.name}&apos;s Benefit
                <HelpTip text="Estimated benefit in today's dollars (find yours at ssa.gov). Grown by the Post-Retirement Raise rate each year." />
              </span>
              <div className="font-medium">
                <InlineEdit
                  value={ps.socialSecurityMonthly}
                  onSave={(v) => {
                    const parsed = parseFloat(v);
                    if (isNaN(parsed) || parsed < 0) return;
                    upsertPerson.mutate({
                      profileId,
                      personId: ps.personId,
                      socialSecurityMonthly: String(parsed),
                    });
                  }}
                  formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                  parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                  type="number"
                  className="text-sm"
                  isEditable={isEditable}
                />
                <span className="text-caption text-faint">
                  {formatCurrency(Number(ps.socialSecurityMonthly) * 12)}
                  /yr
                </span>
              </div>
            </div>
          ))
        ) : (
          <div>
            <span className="text-muted">
              Monthly Benefit
              <HelpTip text="Estimated benefit in today's dollars (find yours at ssa.gov). Grown by the Post-Retirement Raise rate each year." />
            </span>
            <div className="font-medium">
              <InlineEdit
                value={settings.socialSecurityMonthly}
                onSave={(v) => {
                  const parsed = parseFloat(v);
                  if (isNaN(parsed) || parsed < 0) return;
                  upsertPerson.mutate({
                    profileId,
                    personId: settings.personId,
                    socialSecurityMonthly: String(parsed),
                  });
                }}
                formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-sm"
                isEditable={isEditable}
              />
              <span className="text-caption text-faint">
                {formatCurrency(Number(settings.socialSecurityMonthly) * 12)}
                /yr
              </span>
            </div>
          </div>
        )}
        <div>
          <span className="text-muted">
            Start Age
            <HelpTip text="62 = earliest (reduced), 67 = full, 70 = max (+8%/yr for delay)." />
          </span>
          <div className="font-medium">
            <InlineEdit
              value={String(settings.ssStartAge)}
              onSave={(v) => {
                const parsed = parseInt(v, 10);
                if (isNaN(parsed) || parsed < 62 || parsed > 75) return;
                upsertHouseholdFields.mutate({ profileId, ssStartAge: parsed });
              }}
              type="number"
              className="text-sm"
              isEditable={isEditable}
            />
          </div>
        </div>
        <div>
          <span className="text-muted">
            Taxable Portion
            <HelpTip text="Percentage subject to federal tax. Most retirees with other income hit the 85% threshold." />
          </span>
          <div className="font-medium text-muted">~85%</div>
        </div>
      </div>
    </div>
  );
}
