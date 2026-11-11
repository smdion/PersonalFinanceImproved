"use client";

import { isRothIraContribution } from "@/lib/pure/contributions/roth-ira";
import { RothRouteSelect } from "@/components/contributions/roth-route-select";
import { capMessage } from "@/lib/pure/contributions/contribution-caps";
import {
  matchFigureForForm,
  matchValueToStore,
} from "@/lib/pure/contributions/match-display";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { LabelOptions } from "@/components/ui/label-options";
import { Toggle } from "@/components/ui/toggle";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
} from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import { InlineAccountType } from "./inline-account-type";
import { InstitutionPicker } from "./institution-picker";
import { trpc } from "@/lib/trpc";
import type { ContributionCardProps } from "../paycheck/types";
import { isOverflowTarget, getDisplayConfig } from "@/lib/config/account-types";
import {
  TAX_TREATMENT_LABELS as TAX_LABELS,
  CONTRIBUTION_METHOD_LABELS_SHORT,
  EMPLOYER_MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
  noEmployerMatchLabel,
} from "@/lib/config/display-labels";
import { AutoMax } from "./contrib-card-auto-max";

export function ContributionCard({
  contrib: c,
  onUpdateContribution,
  onToggleAutoMax,
  onDeleteContribution,
  onUpdateInstitution,
  _methodLabel,
  salary,
  periodsPerYear,
  annualLimit,
  siblingAnnualContributions = 0,
  employerMatchAnnual = 0,
  readOnly,
  contributionValueReadOnly,
}: ContributionCardProps) {
  const valueEditable = !readOnly && !contributionValueReadOnly;
  const [editingInstitution, setEditingInstitution] = useState(false);
  const { data: performanceAccounts } =
    trpc.performance.performanceAccounts.list.useQuery(undefined, {
      enabled: !readOnly && !!onUpdateInstitution,
    });
  const linkedInstitution = performanceAccounts?.find(
    (pa) => pa.id === c.performanceAccountId,
  );
  const matchFigure = matchFigureForForm(
    c.employerMatchType,
    c.employerMatchValue ?? (c.employerMatchRate == null ? "0" : null),
    c.employerMatchRate,
  );
  const saveMatchFigure = (v: string) =>
    onUpdateContribution(
      c.id,
      "employerMatchValue",
      matchValueToStore(c.employerMatchType, v),
    );

  return (
    <div className="bg-surface-primary group/card relative rounded-lg border p-3 text-sm shadow-sm">
      {!readOnly && onDeleteContribution && (
        <button
          onClick={async () => {
            if (
              await confirm(
                `Remove ${accountDisplayName({ accountType: c.accountType })} (${c.taxTreatment}) contribution account?`,
              )
            )
              onDeleteContribution(c.id);
          }}
          className="text-caption absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 leading-none text-red-500 opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-red-200"
          title="Delete contribution account"
        >
          ×
        </button>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {c.displayNameCustom ? (
            <span className="text-xs font-medium text-amber-600">
              {c.displayNameCustom}
            </span>
          ) : (
            <>
              <InlineAccountType
                value={c.accountType}
                onSave={(v) => onUpdateContribution(c.id, "accountType", v)}
              />
              {c.ownership === "joint" && (
                <span className="text-faint text-xs font-medium">(Joint)</span>
              )}
              {c.hsaCoverageType === "family" && (
                <span className="text-xs font-medium text-blue-600">
                  (Family)
                </span>
              )}
              {isOverflowTarget(c.accountType) && (c.subType || c.label) && (
                <span className="text-muted text-xs font-medium">
                  {getDisplayConfig(
                    c.accountType,
                    c.subType,
                  ).displayLabel.toLowerCase() !== c.accountType.toLowerCase()
                    ? getDisplayConfig(c.accountType, c.subType).displayLabel
                    : (c.label ?? c.subType)}
                </span>
              )}
            </>
          )}
          <span className="text-faint text-xs">
            {TAX_LABELS[c.taxTreatment] ?? c.taxTreatment}
          </span>
          {c.jobId === null && (
            <span
              className="text-caption rounded bg-indigo-50 px-0.5 leading-tight font-semibold text-indigo-600"
              title="Also tracked as a budget item. Values are independent — editing here won't change the budget."
            >
              BG
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <InlineEdit
            value={c.contributionValue}
            onSave={(v) => onUpdateContribution(c.id, "contributionValue", v)}
            formatDisplay={(v) => {
              const num = Number(v);
              return c.contributionMethod === "percent_of_salary"
                ? formatPercent(num / 100)
                : formatCurrency(num);
            }}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
            isEditable={valueEditable}
          />
          <select
            aria-label="Contribution method"
            disabled={!valueEditable}
            value={c.contributionMethod}
            onChange={(e) =>
              onUpdateContribution(c.id, "contributionMethod", e.target.value)
            }
            className="text-caption text-faint hover:text-secondary cursor-pointer appearance-none border-none bg-transparent pr-3 focus:outline-none"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0 center",
            }}
            title="Change contribution method"
          >
            <LabelOptions labels={CONTRIBUTION_METHOD_LABELS_SHORT} />
          </select>
        </div>
      </div>

      {capMessage(c) && (
        <p
          className={`text-caption mt-1 ${(c.cap?.overBy ?? 0) > 0 ? "font-medium text-red-600" : "text-amber-600"}`}
        >
          {capMessage(c)}
        </p>
      )}
      {c.ownership === "joint" && (
        <p className="text-caption text-faint mt-1">
          Shared contribution (total, not per person)
        </p>
      )}

      {!readOnly && onUpdateInstitution && (
        <div className="mt-1">
          {editingInstitution ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <InstitutionPicker
                  personId={c.ownership === "joint" ? null : c.personId}
                  accountType={c.accountType}
                  value={c.performanceAccountId}
                  onChange={(id) => {
                    onUpdateInstitution(c.id, id);
                    setEditingInstitution(false);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setEditingInstitution(false)}
                className="text-caption text-faint hover:text-secondary pb-1.5"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingInstitution(true)}
              className="text-caption text-faint hover:text-secondary"
            >
              {linkedInstitution
                ? accountDisplayName(linkedInstitution)
                : "Link institution"}
            </button>
          )}
        </div>
      )}

      {c.employerMatchType !== "none" && (
        <div className="text-muted mt-1 flex flex-wrap items-center gap-1 text-xs">
          {EMPLOYER_MATCH_VALUE_UNIT[c.employerMatchType] === "$" ? (
            <>
              <span>Employer:</span>
              <InlineEdit
                value={matchFigure}
                onSave={saveMatchFigure}
                formatDisplay={(v) => `${formatCurrency(Number(v))}/yr`}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
                isEditable={!readOnly}
              />
            </>
          ) : getDisplayConfig(c.accountType, c.subType).hasDiscountBar ? (
            <>
              <InlineEdit
                value={matchFigure}
                onSave={saveMatchFigure}
                formatDisplay={(v) => formatPercent(Number(v) / 100, 0)}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
                isEditable={!readOnly}
              />
              <span>discount</span>
            </>
          ) : (
            <>
              <span>Employer match:</span>
              <InlineEdit
                value={matchFigure}
                onSave={saveMatchFigure}
                formatDisplay={(v) => formatPercent(Number(v) / 100, 0)}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
                isEditable={!readOnly}
              />
              {c.employerMaxMatchPct && (
                <>
                  <span>up to</span>
                  <InlineEdit
                    value={c.employerMaxMatchPct}
                    onSave={(v) =>
                      onUpdateContribution(c.id, "employerMaxMatchPct", v)
                    }
                    formatDisplay={(v) =>
                      `${formatPercent(Number(v))} of salary`
                    }
                    parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                    type="number"
                    className="text-muted"
                    isEditable={!readOnly}
                  />
                </>
              )}
            </>
          )}
          <select
            aria-label="Employer match type"
            disabled={readOnly}
            value={c.employerMatchType}
            onChange={(e) =>
              onUpdateContribution(c.id, "employerMatchType", e.target.value)
            }
            className="text-caption text-faint hover:text-secondary ml-1 cursor-pointer border-none bg-transparent focus:outline-none"
          >
            <LabelOptions labels={EMPLOYER_MATCH_LABELS} />
          </select>
        </div>
      )}
      {c.employerMatchType === "none" && (
        <div className="text-caption text-faint mt-1">
          {employerMatchAnnual > 0 && (
            <span className="text-muted mr-1">
              Employer match: {formatCurrency(employerMatchAnnual)}/yr (combined
              with this account&apos;s other tax-treatment split) ·
            </span>
          )}
          <select
            aria-label="Add employer match"
            disabled={readOnly}
            value="none"
            onChange={(e) =>
              onUpdateContribution(c.id, "employerMatchType", e.target.value)
            }
            className="text-caption text-faint hover:text-secondary cursor-pointer border-none bg-transparent focus:outline-none"
          >
            <option value="none">
              {noEmployerMatchLabel(c, employerMatchAnnual > 0)}
            </option>
            <option value="percent_of_contribution">Add % match</option>
            <option value="dollar_match">Add $ match</option>
            <option value="fixed_annual">Add fixed annual match</option>
          </select>
        </div>
      )}

      {/* The Contribution Profile's bonus-check election (bonusCheckContribution),
          payroll accounts only: nothing else is on a check. */}
      {isPaidThroughPayroll(c) && (
        <div className="mt-1">
          <Toggle
            isChecked={c.fromBonus === true}
            onChange={(v) => onUpdateContribution(c.id, "fromBonus", String(v))}
            label="Also taken from bonus checks"
            size="xs"
            title="The bonus check takes this contribution too: a percent of pay at its rate of the bonus, a fixed amount once more. The employer match follows."
            disabled={!valueEditable}
          />
        </div>
      )}

      {/* A Roth IRA's route — the Contribution Profile's election; the
          Roth IRA verdict and recommendation read it. */}
      {isRothIraContribution(c) && (
        <div className="mt-1">
          <RothRouteSelect
            value={c.rothRoute}
            disabled={!valueEditable}
            onChange={(v) => onUpdateContribution(c.id, "rothRoute", v)}
          />
        </div>
      )}

      {onToggleAutoMax && (
        <AutoMax
          contribution={c}
          annualLimit={annualLimit}
          employerMatchAnnual={employerMatchAnnual}
          siblingAnnualContributions={siblingAnnualContributions}
          salary={salary}
          periodsPerYear={periodsPerYear}
          readOnly={readOnly}
          onToggleAutoMax={onToggleAutoMax}
        />
      )}
    </div>
  );
}
