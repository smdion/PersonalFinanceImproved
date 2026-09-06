/**
 * Social Security settings panel. The upsertSettings mutation passes
 * through as a prop so the parent keeps owning the optimistic-update glue.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { ClaimingAgeExplorer } from "./claiming-age-explorer";
import type {
  Settings,
  PerPersonSettings,
  UpsertProfilePersonMutation,
  UpsertProfileHouseholdFieldsMutation,
  IsEditable,
} from "./types";

/** `""` -> not opted in (`null` on save). A positive parsed number -> opted
 *  in. Mirrors `piaAnnual()`'s guard in build-engine-payload.ts — this is
 *  the DISPLAY-side twin of that same "what counts as opted in" question,
 *  so the UI and the engine can't disagree on it. */
function parsedPia(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

  const peopleWithPia: {
    personId: number;
    name: string | null;
    pia: number;
  }[] =
    perPersonSettings && perPersonSettings.length > 1
      ? perPersonSettings.flatMap((ps) => {
          const pia = parsedPia(ps.socialSecurityPia);
          return pia != null
            ? [{ personId: ps.personId, name: ps.name, pia }]
            : [];
        })
      : (() => {
          const pia = parsedPia(perPersonSettings?.[0]?.socialSecurityPia);
          return pia != null
            ? [{ personId: settings.personId, name: null, pia }]
            : [];
        })();

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Social Security
        </h4>
        <Badge color="indigo">Baseline + Simulation</Badge>
        <div className="flex-1 border-t" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
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
              <div className="mt-1">
                <span className="text-muted">
                  {ps.name}&apos;s PIA (optional)
                  <HelpTip text="Primary Insurance Amount — the benefit at Full Retirement Age, from your SSA statement. Entering it lets the app adjust for early/delayed claiming and compare claiming ages below. Leave blank to keep using the flat Monthly Benefit above unadjusted." />
                </span>
                <div className="font-medium">
                  <InlineEdit
                    value={ps.socialSecurityPia ?? ""}
                    onSave={(v) => {
                      if (v === "") {
                        upsertPerson.mutate({
                          profileId,
                          personId: ps.personId,
                          socialSecurityPia: null,
                        });
                        return;
                      }
                      const parsed = parseFloat(v);
                      if (isNaN(parsed) || parsed <= 0) return;
                      upsertPerson.mutate({
                        profileId,
                        personId: ps.personId,
                        socialSecurityPia: String(parsed),
                      });
                    }}
                    formatDisplay={(v) =>
                      parsedPia(v) != null
                        ? `${formatCurrency(Number(v))}/mo`
                        : "Not set"
                    }
                    parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                    type="number"
                    className="text-sm"
                    isEditable={isEditable}
                  />
                </div>
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
                value={
                  perPersonSettings?.[0]?.socialSecurityMonthly ??
                  settings.socialSecurityMonthly
                }
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
                {formatCurrency(
                  Number(
                    perPersonSettings?.[0]?.socialSecurityMonthly ??
                      settings.socialSecurityMonthly,
                  ) * 12,
                )}
                /yr
              </span>
            </div>
          </div>
        )}
        {(!perPersonSettings || perPersonSettings.length <= 1) && (
          <div>
            <span className="text-muted">
              PIA (optional)
              <HelpTip text="Primary Insurance Amount — the benefit at Full Retirement Age, from your SSA statement. Entering it lets the app adjust for early/delayed claiming and compare claiming ages below. Leave blank to keep using the flat Monthly Benefit above unadjusted." />
            </span>
            <div className="font-medium">
              <InlineEdit
                value={perPersonSettings?.[0]?.socialSecurityPia ?? ""}
                onSave={(v) => {
                  if (v === "") {
                    upsertPerson.mutate({
                      profileId,
                      personId: settings.personId,
                      socialSecurityPia: null,
                    });
                    return;
                  }
                  const parsed = parseFloat(v);
                  if (isNaN(parsed) || parsed <= 0) return;
                  upsertPerson.mutate({
                    profileId,
                    personId: settings.personId,
                    socialSecurityPia: String(parsed),
                  });
                }}
                formatDisplay={(v) =>
                  parsedPia(v) != null
                    ? `${formatCurrency(Number(v))}/mo`
                    : "Not set"
                }
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-sm"
                isEditable={isEditable}
              />
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
              value={String(
                perPersonSettings && perPersonSettings.length === 1
                  ? perPersonSettings[0]!.ssStartAge
                  : settings.ssStartAge,
              )}
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
          <div className="text-muted font-medium">~85%</div>
        </div>
      </div>
      {peopleWithPia.length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {peopleWithPia.map((p) => (
            <ClaimingAgeExplorer
              key={p.personId}
              personId={p.personId}
              pia={p.pia}
              personName={p.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}
