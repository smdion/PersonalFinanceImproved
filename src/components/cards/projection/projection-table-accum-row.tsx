import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { accountTextColor, taxTypeTextColor, taxTypeLabel } from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  AccountCategory,
  EngineAccumulationYear,
  AccumulationSlot,
} from "@/lib/calculators/types";
import {
  type AccountCategory as AcctCat,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  getAccountTypeConfig,
  getDisplayConfig,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import type { TipColor, TooltipLineItem } from "./types";
import {
  catDisplayLabel,
  bucketSlotMap,
  _singleBucketCategories,
  isAccumYear,
  itemTaxType,
  colKeyParts,
  colBalance,
  safeDivide,
  colEngineTaxType,
  slotBucketContrib,
  slotsColumnBalanceInflow,
  slotsBucketBalanceInflow,
  filterSpecsForBucket,
  iaBelongsToBucket,
  pctOf,
  proRateMonths,
  specFrac,
  matchFracOf,
  computeColumnChange,
  computeAccountSplits,
} from "./utils";
import type { ProjectionState } from "./projection-table-types";
import { renderMcCell, type RenderMcCellOptions } from "./projection-table-mc-cell";

export type AccumulationRowProps = {
  yr: EngineAccumulationYear;
  state: ProjectionState;
  parentCategoryFilter?: string;
  isPhaseTransition: boolean;
  hasOverride: boolean;
  accumOverrideNotes?: string;
  salaryOverrideNotes?: string | null;
  budgetOverrideNotes?: string | null;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  people?: { id: number; name: string; birthYear: number }[];
  mcCellOpts: RenderMcCellOptions;
};

export function AccumulationRow({
  yr,
  state: s,
  parentCategoryFilter,
  isPhaseTransition,
  hasOverride,
  accumOverrideNotes,
  salaryOverrideNotes,
  budgetOverrideNotes,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  people,
  mcCellOpts,
}: AccumulationRowProps) {
  const {
    accumOverrides,
    balanceView, contribView,
    diagMode,
    personFilter, isPersonFiltered, personFilterName,
    visibleColumns,
    deflate, getPersonYearTotals, baseYear, displayAge, renderTooltip,
    enginePeople, engineSettings, realDefaults,
    contribSpecs, budgetProfileSummaries,
    result,
  } = s;

  if (!result) return null;

  const slotMap = new Map<AccountCategory, AccumulationSlot>(
    yr.slots.map((s) => [s.category, s]),
  );
  const pt = getPersonYearTotals(yr);
  // When parentCategoryFilter is active, compute brokerage contributions
  // from individual accounts matching the filter (e.g. Retirement page
  // should not include Portfolio-parentCategory brokerage like Long Term).
  const pcfBrokContrib =
    parentCategoryFilter
      ? (() => {
          const iabs =
            yr.individualAccountBalances ?? [];
          const matching = iabs.filter(
            (ia) =>
              ACCOUNT_TYPE_CONFIG[
                ia.category as AcctCat
              ]?.isOverflowTarget &&
              ia.parentCategory ===
                parentCategoryFilter,
          );
          if (matching.length === 0) return null;
          return {
            employee: matching.reduce(
              (s, ia) => s + ia.contribution,
              0,
            ),
            match: matching.reduce(
              (s, ia) => s + ia.employerMatch,
              0,
            ),
          };
        })()
      : undefined;
  // How much brokerage contrib to subtract from totals on filtered pages
  const pcfBrokAdj =
    parentCategoryFilter && !pt
      ? (() => {
          const iabs =
            yr.individualAccountBalances ?? [];
          const allBrok = iabs.filter(
            (ia) =>
              ACCOUNT_TYPE_CONFIG[
                ia.category as AcctCat
              ]?.isOverflowTarget,
          );
          const matchBrok = allBrok.filter(
            (ia) =>
              ia.parentCategory ===
              parentCategoryFilter,
          );
          return {
            employee:
              allBrok.reduce(
                (s, ia) => s + ia.contribution,
                0,
              ) -
              matchBrok.reduce(
                (s, ia) => s + ia.contribution,
                0,
              ),
            match:
              allBrok.reduce(
                (s, ia) => s + ia.employerMatch,
                0,
              ) -
              matchBrok.reduce(
                (s, ia) => s + ia.employerMatch,
                0,
              ),
          };
        })()
      : { employee: 0, match: 0 };
  return (
    <tr
      key={yr.year}
      className={`border-b border-subtle hover:bg-surface-elevated/60 transition-colors ${
        isPhaseTransition
          ? "bg-blue-50 font-medium"
          : hasOverride
            ? "bg-emerald-50"
            : yr.overflowToBrokerage > 0
              ? "bg-amber-50/50"
              : ""
      }`}
    >
      <td className="py-1.5 pr-2 whitespace-nowrap">
        {yr.year}
        {yr.proRateFraction != null && (
          <Tooltip
            content={`Partial year: only ${proRateMonths(yr.proRateFraction)} of 12 months remain. All values in this row reflect the remaining months, not the full year.`}
            side="right"
            maxWidth={220}
          >
            <span className="text-[9px] text-blue-500 align-super">
              *
            </span>
          </Tooltip>
        )}
      </td>
      <Tooltip
        content={(() => {
          const pp = people ?? enginePeople;
          if (!pp || pp.length < 2)
            return undefined;
          return renderTooltip({
            kind: "info",
            lines: pp.map((p) => ({
              text: `${p.name}: ${yr.year - p.birthYear}`,
              style: "header" as const,
            })),
          });
        })()}
        side="top"
      >
        <td className="py-1.5 px-2">
          {displayAge(yr.year) ?? yr.age}
        </td>
      </Tooltip>
      <td className="py-1.5 px-2">
        <span className="text-green-600 text-[10px] font-medium">
          SAVE
        </span>
      </td>
      <Tooltip
        content={(() => {
          const prevYr =
            result.projectionByYear.find(
              (y) => y.year === yr.year - 1,
            );
          // Use person-filtered salary if applicable
          const personId =
            isPersonFiltered &&
            enginePeople?.find(
              (p) => p.id === personFilter,
            )?.id;
          const currentSal = personId
            ? (yr.projectedSalaryByPerson?.[
                personId
              ] ?? yr.projectedSalary)
            : yr.projectedSalary;
          const prevSalary =
            prevYr &&
            prevYr.phase === "accumulation"
              ? personId
                ? ((
                    prevYr as EngineAccumulationYear
                  ).projectedSalaryByPerson?.[
                    personId
                  ] ??
                  (
                    prevYr as EngineAccumulationYear
                  ).projectedSalary)
                : (
                    prevYr as EngineAccumulationYear
                  ).projectedSalary
              : null;
          const pctChange =
            prevSalary && prevSalary > 0
              ? (currentSal - prevSalary) /
                prevSalary
              : null;
          const lines: {
            text: string;
            style: "header" | "meta" | "note";
            color?: TipColor;
          }[] = [];
          if (yr.hasSalaryOverride) {
            lines.push({
              text: `Salary overridden for this year${salaryOverrideNotes ? ` — ${salaryOverrideNotes}` : ""}`,
              style: "note",
              color: "emerald",
            });
          } else if (pctChange !== null) {
            lines.push({
              text: `${pctChange >= 0 ? "+" : ""}${formatPercent(pctChange, 1)} from prior year`,
              style: "header",
            });
          } else {
            lines.push({
              text: "Base salary (year 1)",
              style: "header",
            });
          }
          if (
            !yr.hasSalaryOverride &&
            engineSettings
          ) {
            lines.push({
              text: `Annual raise: ${formatPercent(Number(engineSettings.salaryAnnualIncrease), 1)}/yr`,
              style: "meta",
            });
          }
          return renderTooltip({
            kind: "info",
            lines,
          });
        })()}
        side="top"
      >
        <td className="text-right py-1.5 px-2 text-muted">
          {(() => {
            let displaySalary =
              yr.projectedSalary;
            if (
              isPersonFiltered &&
              yr.projectedSalaryByPerson &&
              enginePeople
            ) {
              const person = enginePeople.find(
                (p) => p.id === personFilter,
              );
              if (
                person &&
                yr.projectedSalaryByPerson[
                  person.id
                ] != null
              ) {
                displaySalary =
                  yr.projectedSalaryByPerson[
                    person.id
                  ]!;
              }
            }
            return formatCurrency(
              deflate(displaySalary, yr.year),
            );
          })()}
        </td>
      </Tooltip>
      <Tooltip
        content={
          yr.projectedSalary > 0
            ? (() => {
                const effectiveSalary =
                  yr.proRateFraction != null &&
                  yr.proRateFraction > 0
                    ? yr.projectedSalary *
                      yr.proRateFraction
                    : yr.projectedSalary;
                const effectiveRate = safeDivide(
                  yr.totalEmployee,
                  effectiveSalary,
                );
                const lines: {
                  text: string;
                  style:
                    | "header"
                    | "meta"
                    | "note";
                  color?: TipColor;
                }[] = [
                  {
                    text: `${formatCurrency(deflate(yr.totalEmployee, yr.year))} / ${formatCurrency(deflate(effectiveSalary, yr.year))} = ${formatPercent(effectiveRate, 1)}`,
                    style: "header",
                  },
                  {
                    text: `Target rate: ${formatPercent(yr.config.contributionRate, 1)}`,
                    style: "meta",
                  },
                ];
                if (yr.proRateFraction != null) {
                  lines.push({
                    text: `${proRateMonths(yr.proRateFraction)}/12 mo — salary pro-rated from ${formatCurrency(deflate(yr.projectedSalary, yr.year))}/yr`,
                    style: "meta",
                  });
                }
                if (
                  yr.rateCeilingScale != null &&
                  yr.rateCeilingScale < 1 &&
                  yr.rateCeilingScale > 0
                ) {
                  lines.push({
                    text: `Uncapped rate: ${formatPercent(safeDivide(yr.totalEmployee, effectiveSalary * yr.rateCeilingScale), 1)} → ${formatPercent(effectiveRate, 1)} (ceiling applied)`,
                    style: "note",
                    color: "amber",
                  });
                }
                if (yr.rateCeilingScale == null) {
                  const diff =
                    effectiveRate -
                    yr.config.contributionRate;
                  if (Math.abs(diff) > 0.001) {
                    lines.push({
                      text: `Actual ${diff > 0 ? "higher" : "lower"} — per-account specs${diff < 0 ? " / IRS limits" : ""}`,
                      style: "note",
                      color: "amber",
                    });
                  }
                }
                if (
                  accumOverrides.some(
                    (o) =>
                      o.year === yr.year &&
                      o.contributionRate !==
                        undefined,
                  )
                ) {
                  lines.push({
                    text: `Overridden for this year${accumOverrideNotes ? ` — ${accumOverrideNotes}` : ""}`,
                    style: "note",
                    color: "emerald",
                  });
                }
                return renderTooltip({
                  kind: "info",
                  lines,
                });
              })()
            : undefined
        }
        side="top"
      >
        <td className="text-right py-1.5 px-2 text-faint">
          {yr.projectedSalary > 0
            ? formatPercent(
                safeDivide(
                  yr.totalEmployee,
                  yr.proRateFraction != null &&
                    yr.proRateFraction > 0
                    ? yr.projectedSalary *
                        yr.proRateFraction
                    : yr.projectedSalary,
                ),
                1,
              )
            : "---"}
        </td>
      </Tooltip>
      {contribView === "account" ? (
        <>
          {getAllCategories()
            .filter(
              (c) =>
                !ACCOUNT_TYPE_CONFIG[c]
                  .isOverflowTarget &&
                visibleColumns.contribCats.has(c),
            )
            .map((cat) => {
              const slot = slotMap.get(cat);
              const rawEmp =
                slot?.employeeContrib ?? 0;
              const rawMatch =
                slot?.employerMatch ?? 0;
              const catContrib =
                pt?.byCategoryContrib[cat];
              const emp = catContrib
                ? catContrib.employee
                : rawEmp;
              const match = catContrib
                ? catContrib.match
                : rawMatch;
              const total = emp + match;
              // Build per-person breakdown for tooltip
              const catSpecs =
                contribSpecs?.filter(
                  (s) => s.category === cat,
                ) ?? [];
              const specTotal = catSpecs.reduce(
                (s, sp) =>
                  s + (sp.baseAnnual || 0),
                0,
              );
              const catLabel =
                catDisplayLabel[cat] ?? cat;
              const finalTooltip =
                emp > 0 || match > 0
                  ? (() => {
                      const items: TooltipLineItem[] =
                        catSpecs.length > 1
                          ? catSpecs
                              .filter(
                                (sp) =>
                                  !isPersonFiltered ||
                                  sp.personId ===
                                    personFilter,
                              )
                              .map((sp) => {
                                const frac =
                                  specFrac({
                                    baseAnnual:
                                      sp.baseAnnual ||
                                      0,
                                    specTotal,
                                    specCount:
                                      catSpecs.length,
                                  });
                                const personEmp =
                                  rawEmp * frac;
                                const label =
                                  sp.ownerName
                                    ? `${sp.ownerName} (${sp.name})`
                                    : sp.name;
                                const matchTotal =
                                  catSpecs.reduce(
                                    (s2, s2p) =>
                                      s2 +
                                      (s2p.matchAnnual ??
                                        0),
                                    0,
                                  );
                                const mFrac =
                                  matchFracOf({
                                    matchAnnual:
                                      sp.matchAnnual ??
                                      0,
                                    allMatchAnnual:
                                      matchTotal,
                                  });
                                return {
                                  label,
                                  amount: deflate(
                                    personEmp,
                                    yr.year,
                                  ),
                                  taxType:
                                    itemTaxType(
                                      cat,
                                      sp.taxTreatment,
                                    ),
                                  match:
                                    (sp.matchAnnual ??
                                      0) > 0
                                      ? deflate(
                                          rawMatch *
                                            mFrac,
                                          yr.year,
                                        )
                                      : undefined,
                                  matchLabel:
                                    getDisplayConfig(
                                      cat,
                                      sp.name !==
                                        cat
                                        ? sp.name
                                        : undefined,
                                    )
                                      .employerMatchLabel,
                                };
                              })
                          : [
                              {
                                label:
                                  catSpecs[0]
                                    ?.ownerName ??
                                  (isPersonFiltered
                                    ? personFilterName
                                    : "Employee"),
                                amount: deflate(
                                  emp,
                                  yr.year,
                                ),
                                taxType:
                                  itemTaxType(
                                    cat,
                                    catSpecs[0]
                                      ?.taxTreatment,
                                  ),
                                match:
                                  match > 0
                                    ? deflate(
                                        match,
                                        yr.year,
                                      )
                                    : undefined,
                                matchLabel:
                                  getDisplayConfig(
                                    cat,
                                    catSpecs[0]
                                      ?.name !==
                                      cat
                                      ? catSpecs[0]
                                          ?.name
                                      : undefined,
                                  )
                                    .employerMatchLabel,
                              },
                            ];
                      return renderTooltip({
                        kind: "money",
                        header: `${catLabel} Contributions`,
                        items,
                        taxSplit:
                          getAccountTypeConfig(
                            cat,
                          ).supportsRothSplit &&
                          slot &&
                          (slot.rothContrib > 0 ||
                            slot.traditionalContrib >
                              0)
                            ? {
                                traditional:
                                  deflate(
                                    slot.traditionalContrib,
                                    yr.year,
                                  ),
                                roth: deflate(
                                  slot.rothContrib,
                                  yr.year,
                                ),
                              }
                            : undefined,
                        rateCeiling:
                          yr.rateCeilingScale !=
                            null &&
                          yr.rateCeilingScale <
                            1 &&
                          yr.rateCeilingScale > 0
                            ? {
                                uncapped: deflate(
                                  safeDivide(
                                    emp,
                                    yr.rateCeilingScale,
                                  ),
                                  yr.year,
                                ),
                                capped: deflate(
                                  emp,
                                  yr.year,
                                ),
                                pct:
                                  1 -
                                  yr.rateCeilingScale,
                              }
                            : undefined,
                        irsLimit: slot
                          ? {
                              category: catLabel,
                              limit: deflate(
                                slot.irsLimit,
                                yr.year,
                              ),
                              used: deflate(
                                emp,
                                yr.year,
                              ),
                            }
                          : undefined,
                        proRate:
                          yr.proRateFraction !=
                          null
                            ? {
                                months:
                                  proRateMonths(
                                    yr.proRateFraction,
                                  ),
                                annualAmount:
                                  deflate(
                                    specTotal,
                                    yr.year,
                                  ),
                                proRatedAmount:
                                  deflate(
                                    emp,
                                    yr.year,
                                  ),
                              }
                            : undefined,
                      });
                    })()
                  : undefined;
              return (
                <Tooltip
                  key={cat}
                  content={finalTooltip}
                  side="top"
                >
                  <td
                    className={`text-right py-1.5 px-2 ${accountTextColor(cat)}`}
                  >
                    {formatCurrency(
                      deflate(total, yr.year),
                    )}
                    {match > 0 && (
                      <span className="text-[9px] text-green-600 align-super ml-px">
                        +m
                      </span>
                    )}
                    {getAccountTypeConfig(cat)
                      .hasIrsLimit &&
                      slot?.cappedByAccount && (
                        <Tooltip
                          content="Account cap hit"
                          side="top"
                        >
                          <span className="text-amber-500 ml-0.5">
                            ^
                          </span>
                        </Tooltip>
                      )}
                  </td>
                </Tooltip>
              );
            })}
          {getAllCategories()
            .filter(
              (c) =>
                ACCOUNT_TYPE_CONFIG[c]
                  .isOverflowTarget &&
                visibleColumns.contribCats.has(c),
            )
            .map((ofCat) => {
              const bSlot = slotMap.get(ofCat);
              const ofSpecs =
                contribSpecs?.filter(
                  (s) => s.category === ofCat,
                ) ?? [];
              const ofLabel =
                getAccountTypeConfig(
                  ofCat,
                ).displayLabel;
              const ofRawMatch =
                bSlot?.employerMatch ?? 0;
              // Prefer person filter, then parentCategory filter, then raw slot
              const ofContrib =
                pt?.byCategoryContrib[ofCat] ??
                (parentCategoryFilter
                  ? pcfBrokContrib ?? {
                      employee: 0,
                      match: 0,
                    }
                  : null);
              const ofEmp = ofContrib
                ? ofContrib.employee
                : (bSlot?.employeeContrib ?? 0);
              const ofMatch = ofContrib
                ? ofContrib.match
                : ofRawMatch;
              const finalOfTooltip =
                bSlot &&
                (ofEmp > 0 || ofMatch > 0)
                  ? (() => {
                      const allMatchAnnual =
                        ofSpecs.reduce(
                          (s, sp) =>
                            s +
                            (sp.matchAnnual ?? 0),
                          0,
                        );
                      const items: TooltipLineItem[] =
                        ofSpecs.length > 0
                          ? ofSpecs.map((sp) => {
                              const bSpecTotal =
                                ofSpecs.reduce(
                                  (s, s2) =>
                                    s +
                                    (s2.baseAnnual ||
                                      0),
                                  0,
                                );
                              const frac =
                                specFrac({
                                  baseAnnual:
                                    sp.baseAnnual ||
                                    0,
                                  specTotal:
                                    bSpecTotal,
                                  specCount:
                                    ofSpecs.length,
                                });
                              const label =
                                sp.ownerName
                                  ? `${sp.ownerName} (${sp.name})`
                                  : sp.name;
                              const personOf =
                                ofEmp * frac;
                              const mFrac =
                                matchFracOf({
                                  matchAnnual:
                                    sp.matchAnnual ??
                                    0,
                                  allMatchAnnual,
                                });
                              const spMatch =
                                ofMatch *
                                mFrac;
                              return {
                                label,
                                amount: deflate(
                                  personOf,
                                  yr.year,
                                ),
                                match:
                                  spMatch > 0
                                    ? deflate(
                                        spMatch,
                                        yr.year,
                                      )
                                    : undefined,
                                matchLabel:
                                  getDisplayConfig(
                                    ofCat,
                                    sp.name !==
                                      ofCat
                                      ? sp.name
                                      : undefined,
                                  )
                                    .employerMatchLabel,
                              };
                            })
                          : [
                              {
                                label: "Employee",
                                amount: deflate(
                                  ofEmp,
                                  yr.year,
                                ),
                                match:
                                  ofMatch > 0
                                    ? deflate(
                                        ofMatch,
                                        yr.year,
                                      )
                                    : undefined,
                                matchLabel:
                                  getDisplayConfig(
                                    ofCat,
                                  )
                                    .employerMatchLabel,
                              },
                            ];
                      const ofAnnual =
                        ofSpecs.reduce(
                          (s, sp) =>
                            s +
                            (sp.baseAnnual || 0),
                          0,
                        );
                      return renderTooltip({
                        kind: "money",
                        header: `${ofLabel} Contributions`,
                        items,
                        rateCeiling:
                          yr.rateCeilingScale !=
                            null &&
                          yr.rateCeilingScale < 1
                            ? {
                                uncapped: deflate(
                                  ofEmp /
                                    yr.rateCeilingScale,
                                  yr.year,
                                ),
                                capped: deflate(
                                  ofEmp,
                                  yr.year,
                                ),
                                pct:
                                  1 -
                                  yr.rateCeilingScale,
                              }
                            : undefined,
                        proRate:
                          yr.proRateFraction !=
                            null && ofAnnual > 0
                            ? {
                                months:
                                  proRateMonths(
                                    yr.proRateFraction,
                                  ),
                                annualAmount:
                                  deflate(
                                    ofAnnual,
                                    yr.year,
                                  ),
                                proRatedAmount:
                                  deflate(
                                    ofEmp,
                                    yr.year,
                                  ),
                              }
                            : undefined,
                      });
                    })()
                  : undefined;
              return (
                <Tooltip
                  key={ofCat}
                  content={finalOfTooltip}
                  side="top"
                >
                  <td
                    className={`text-right py-1.5 px-2 ${accountTextColor(ofCat)}${yr.overflowToBrokerage > 0 ? " font-medium" : ""}`}
                  >
                    {ofEmp + ofMatch > 0
                      ? formatCurrency(
                          deflate(
                            ofEmp + ofMatch,
                            yr.year,
                          ),
                        )
                      : "---"}
                    {ofMatch > 0 && (
                      <span className="text-[9px] text-green-600 align-super ml-px">
                        +m
                      </span>
                    )}
                  </td>
                </Tooltip>
              );
            })}
        </>
      ) : (
        /* Contribution columns by tax type */
        (
          [
            "preTax",
            "taxFree",
            "hsa",
            "afterTax",
          ] as const
        )
          .filter((t) =>
            visibleColumns.contribTaxTypes.has(t),
          )
          .map((bucket) => {
            // Build per-spec items for this tax bucket
            let bucketTotal = 0;
            let bucketMatch = 0;
            let bucketAssocMatch = 0;
            const items: TooltipLineItem[] = [];
            for (const slot of yr.slots) {
              const cat = slot.category;
              const allCatSpecs =
                contribSpecs?.filter(
                  (s) => s.category === cat,
                ) ?? [];
              const allMatchAnnual =
                allCatSpecs.reduce(
                  (s, sp) =>
                    s + (sp.matchAnnual ?? 0),
                  0,
                );
              // Determine which specs and slot amounts apply to this bucket (data-driven via bucketSlotMap)
              const isOFTarget =
                ACCOUNT_TYPE_CONFIG[
                  cat as AcctCat
                ]?.isOverflowTarget;
              // When parentCategoryFilter active, use filtered brokerage data
              const slotEmp =
                parentCategoryFilter && isOFTarget
                  ? (pcfBrokContrib?.employee ?? 0)
                  : slotBucketContrib(slot, bucket);
              const slotMatch =
                parentCategoryFilter && isOFTarget
                  ? (pcfBrokContrib?.match ?? 0)
                  : slot.employerMatch;
              const bucketSpecs =
                filterSpecsForBucket(
                  allCatSpecs,
                  bucket,
                );
              const isAssoc =
                bucketSlotMap[bucket]
                  ?.matchIsAssociated ?? false;
              if (
                slotEmp === 0 &&
                slotMatch === 0
              )
                continue;
              if (bucketSpecs.length === 0)
                continue;
              // Distribute slot amounts proportionally across specs
              const specBaseTotal =
                bucketSpecs.reduce(
                  (s, sp) =>
                    s + (sp.baseAnnual || 0),
                  0,
                );
              const catLabel =
                catDisplayLabel[cat] ?? cat;
              for (const sp of bucketSpecs) {
                if (
                  isPersonFiltered &&
                  sp.personId !== personFilter
                )
                  continue;
                const frac = specFrac({
                  baseAnnual: sp.baseAnnual || 0,
                  specTotal: specBaseTotal,
                  specCount: bucketSpecs.length,
                });
                const emp = slotEmp * frac;
                const mFrac = matchFracOf({
                  matchAnnual:
                    sp.matchAnnual ?? 0,
                  allMatchAnnual,
                });
                let mtch = 0;
                let assocMtch = 0;
                if (isAssoc) {
                  assocMtch =
                    slotMatch * mFrac;
                } else {
                  mtch =
                    slotMatch * mFrac;
                }
                if (
                  emp > 0 ||
                  mtch > 0 ||
                  assocMtch > 0
                ) {
                  items.push({
                    label: sp.ownerName
                      ? `${sp.ownerName} ${catLabel}`
                      : catLabel,
                    amount: deflate(emp, yr.year),
                    taxType: itemTaxType(
                      cat,
                      sp.taxTreatment,
                    ),
                    match:
                      mtch > 0
                        ? deflate(mtch, yr.year)
                        : undefined,
                    matchLabel: getDisplayConfig(
                      cat,
                      sp.name !== cat
                        ? sp.name
                        : undefined,
                    ).employerMatchLabel,
                    associatedMatch:
                      assocMtch > 0
                        ? deflate(
                            assocMtch,
                            yr.year,
                          )
                        : undefined,
                  });
                  bucketTotal += emp;
                  bucketMatch += mtch;
                  bucketAssocMatch += assocMtch;
                }
              }
            }
            const total =
              bucketTotal + bucketMatch;
            // Compute annual (full-year) amount from specs for this bucket (data-driven)
            let bucketAnnual = 0;
            const bMap = bucketSlotMap[bucket];
            for (const slot of yr.slots) {
              // Skip slots that don't contribute to this bucket
              if (
                bMap?.categoryFilter &&
                slot.category !==
                  bMap.categoryFilter
              )
                continue;
              if (
                !bMap?.categoryFilter &&
                _singleBucketCategories.has(
                  slot.category,
                )
              )
                continue;
              const catSpAll =
                contribSpecs?.filter(
                  (s) =>
                    s.category === slot.category,
                ) ?? [];
              const filtered =
                filterSpecsForBucket(
                  catSpAll,
                  bucket,
                );
              bucketAnnual += filtered.reduce(
                (s, sp) =>
                  s + (sp.baseAnnual || 0),
                0,
              );
            }
            return (
              <Tooltip
                key={bucket}
                content={
                  items.length > 0
                    ? (() => {
                        return renderTooltip({
                          kind: "money",
                          header: `${taxTypeLabel(bucket)} Contributions`,
                          items,
                          total:
                            items.length > 1
                              ? {
                                  label: "Total",
                                  amount: deflate(
                                    bucketTotal,
                                    yr.year,
                                  ),
                                  match:
                                    bucketMatch +
                                      bucketAssocMatch >
                                    0
                                      ? deflate(
                                          bucketMatch +
                                            bucketAssocMatch,
                                          yr.year,
                                        )
                                      : undefined,
                                }
                              : undefined,
                          routingNote:
                            bucketAssocMatch > 0
                              ? `Match flows to ${taxTypeLabel("preTax")}`
                              : undefined,
                          proRate:
                            yr.proRateFraction !=
                              null &&
                            bucketAnnual > 0
                              ? {
                                  months:
                                    proRateMonths(
                                      yr.proRateFraction,
                                    ),
                                  annualAmount:
                                    deflate(
                                      bucketAnnual,
                                      yr.year,
                                    ),
                                  proRatedAmount:
                                    deflate(
                                      bucketTotal,
                                      yr.year,
                                    ),
                                }
                              : undefined,
                        });
                      })()
                    : undefined
                }
                side="top"
              >
                <td
                  className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                >
                  {total > 0
                    ? formatCurrency(
                        deflate(total, yr.year),
                      )
                    : "---"}
                  {(bucketMatch > 0 ||
                    bucketAssocMatch > 0) && (
                    <span className="text-[9px] text-green-600 align-super ml-px">
                      +m
                    </span>
                  )}
                </td>
              </Tooltip>
            );
          })
      )}
      <Tooltip
        content={(() => {
          const iabs =
            yr.individualAccountBalances ?? [];
          const totalGrowth = (
            pt
              ? iabs.filter(
                  (ia) =>
                    ia.ownerPersonId ===
                    personFilter,
                )
              : iabs
          ).reduce((s, ia) => s + ia.growth, 0);
          const accBudgetProfile =
            accumulationBudgetProfileId != null
              ? budgetProfileSummaries?.find(
                  (p) =>
                    p.id ===
                    accumulationBudgetProfileId,
                )
              : undefined;
          const mine = pt
            ? iabs.filter(
                (ia) =>
                  ia.ownerPersonId ===
                  personFilter,
              )
            : [];
          const empAmount = deflate(
            pt
              ? pt.contribution
              : yr.totalEmployee -
                  pcfBrokAdj.employee,
            yr.year,
          );
          const matchAmount = pt
            ? deflate(
                mine.reduce(
                  (s, ia) => s + ia.employerMatch,
                  0,
                ),
                yr.year,
              )
            : yr.totalEmployer -
                  pcfBrokAdj.match >
                0
              ? deflate(
                  yr.totalEmployer -
                    pcfBrokAdj.match,
                  yr.year,
                )
              : 0;
          const budgetProfileName =
            accumulationExpenseOverride != null
              ? `Manual override${yr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
              : accBudgetProfile
                ? `${accBudgetProfile.name}${accumulationBudgetColumn != null && accBudgetProfile.columnLabels[accumulationBudgetColumn] ? ` (${accBudgetProfile.columnLabels[accumulationBudgetColumn]})` : ""}${yr.hasBudgetOverride && budgetOverrideNotes ? ` (${budgetOverrideNotes})` : ""}`
                : undefined;
          // Build per-bucket items from slots (shows all tax types that have contributions)
          const inOutItems: TooltipLineItem[] =
            [];
          if (matchAmount > 0)
            inOutItems.push({
              label: "Match",
              amount: matchAmount,
              color: "green",
            });
          if (!pt) {
            const bucketTotals: {
              label: string;
              amount: number;
              color: TipColor;
            }[] = [];
            if (yr.totalTraditional > 0)
              bucketTotals.push({
                label: taxTypeLabel("preTax"),
                amount: deflate(
                  yr.totalTraditional,
                  yr.year,
                ),
                color: "blue",
              });
            if (yr.totalRoth > 0)
              bucketTotals.push({
                label: taxTypeLabel("taxFree"),
                amount: deflate(
                  yr.totalRoth,
                  yr.year,
                ),
                color: "violet",
              });
            // Single-bucket categories (HSA, brokerage, etc.)
            for (const sbCat of getAllCategories().filter(
              (c) =>
                !ACCOUNT_TYPE_CONFIG[c]
                  .supportsRothSplit,
            )) {
              const isOF =
                ACCOUNT_TYPE_CONFIG[sbCat]
                  ?.isOverflowTarget;
              // When parentCategoryFilter active, use filtered brokerage data
              if (
                parentCategoryFilter &&
                isOF
              ) {
                const filteredEmp =
                  pcfBrokContrib?.employee ?? 0;
                if (filteredEmp > 0) {
                  bucketTotals.push({
                    label:
                      getAccountTypeConfig(sbCat)
                        .displayLabel,
                    amount: deflate(
                      filteredEmp,
                      yr.year,
                    ),
                    color: "amber",
                  });
                }
              } else {
                const sbSlot = yr.slots.find(
                  (s) => s.category === sbCat,
                );
                if (
                  sbSlot &&
                  sbSlot.employeeContrib > 0
                ) {
                  bucketTotals.push({
                    label:
                      getAccountTypeConfig(sbCat)
                        .displayLabel,
                    amount: deflate(
                      sbSlot.employeeContrib,
                      yr.year,
                    ),
                    color: isOF
                      ? "amber"
                      : "emerald",
                  });
                }
              }
            }
            inOutItems.push(...bucketTotals);
          } else {
            // Person-filtered: build tax-type breakdown from individual accounts
            const bucketTotals: {
              label: string;
              amount: number;
              color: TipColor;
            }[] = [];
            let ptTrad = 0,
              ptRoth = 0;
            const ptSingleBucket = new Map<
              string,
              number
            >();
            for (const ia of mine) {
              const cfg =
                ACCOUNT_TYPE_CONFIG[ia.category];
              if (cfg?.supportsRothSplit) {
                if (ia.taxType === "preTax")
                  ptTrad += ia.contribution;
                else ptRoth += ia.contribution;
              } else {
                ptSingleBucket.set(
                  ia.category,
                  (ptSingleBucket.get(
                    ia.category,
                  ) ?? 0) + ia.contribution,
                );
              }
            }
            if (ptTrad > 0)
              bucketTotals.push({
                label: taxTypeLabel("preTax"),
                amount: deflate(ptTrad, yr.year),
                color: "blue",
              });
            if (ptRoth > 0)
              bucketTotals.push({
                label: taxTypeLabel("taxFree"),
                amount: deflate(ptRoth, yr.year),
                color: "violet",
              });
            Array.from(
              ptSingleBucket.entries(),
            ).forEach(([sbCat, sbAmt]) => {
              if (sbAmt > 0) {
                const cfg = getAccountTypeConfig(
                  sbCat as AccountCategory,
                );
                bucketTotals.push({
                  label: cfg.displayLabel,
                  amount: deflate(sbAmt, yr.year),
                  color: cfg.isOverflowTarget
                    ? "amber"
                    : "emerald",
                });
              }
            });
            inOutItems.push(...bucketTotals);
          }
          return renderTooltip({
            kind: "money",
            header: `${isPersonFiltered ? personFilterName : "Employee"}: ${formatCurrency(empAmount)}`,
            items:
              inOutItems.length > 0
                ? inOutItems
                : undefined,
            growth:
              Math.abs(totalGrowth) > 1
                ? {
                    amount: deflate(
                      totalGrowth,
                      yr.year,
                    ),
                  }
                : undefined,
            budget: budgetProfileName
              ? {
                  profile: budgetProfileName,
                  amount: deflate(
                    yr.projectedExpenses,
                    yr.year,
                  ),
                }
              : undefined,
            overrideNote:
              accumOverrideNotes &&
              !accumOverrides.some(
                (o) =>
                  o.year === yr.year &&
                  o.contributionRate !==
                    undefined,
              )
                ? `Override: ${accumOverrideNotes}`
                : undefined,
            proRate:
              yr.proRateFraction != null
                ? (() => {
                    const totalAnnual =
                      contribSpecs?.reduce(
                        (s, sp) =>
                          s +
                          (sp.baseAnnual || 0),
                        0,
                      ) ?? 0;
                    return totalAnnual > 0
                      ? {
                          months: proRateMonths(
                            yr.proRateFraction,
                          ),
                          annualAmount: deflate(
                            totalAnnual,
                            yr.year,
                          ),
                          proRatedAmount:
                            empAmount,
                        }
                      : undefined;
                  })()
                : undefined,
          });
        })()}
        side="top"
      >
        <td className="text-right py-1.5 px-2 font-medium">
          {formatCurrency(
            deflate(
              pt
                ? pt.contribution
                : yr.totalEmployee +
                    yr.totalEmployer -
                    pcfBrokAdj.employee -
                    pcfBrokAdj.match,
              yr.year,
            ),
          )}
          {yr.totalEmployer -
            pcfBrokAdj.match >
            0 && (
            <span className="text-[9px] text-green-600 align-super ml-px">
              +m
            </span>
          )}
        </td>
      </Tooltip>
      {balanceView === "taxType" ? (
        (
          [
            "preTax",
            "taxFree",
            "hsa",
            "afterTax",
          ] as const
        )
          .filter((t) =>
            visibleColumns.balanceTaxTypes.has(t),
          )
          .map((bucket) => {
            const bal = pt
              ? pt.byTaxType[bucket]
              : yr.balanceByTaxType[bucket];
            const totalBal = pt
              ? pt.balance
              : yr.endBalance;
            const pct = pctOf(bal, totalBal);
            // Compute authoritative total change from engine's year-over-year balance
            const prevYr =
              result.projectionByYear.find(
                (y) => y.year === yr.year - 1,
              );
            const prevPt = prevYr
              ? getPersonYearTotals(prevYr)
              : null;
            const prevBucketBal = prevYr
              ? prevPt
                ? prevPt.byTaxType[bucket]
                : prevYr.balanceByTaxType[bucket]
              : 0;
            // Compute splitContrib from authoritative slot data (mirrors engine balance routing)
            const splitContrib =
              slotsBucketBalanceInflow(
                yr.slots,
                bucket,
              );
            // Build per-account items from individual account balances (for balance/growth detail)
            const bucketAccts = (
              yr.individualAccountBalances ?? []
            ).filter(
              (ia) =>
                iaBelongsToBucket(ia, bucket) &&
                (!isPersonFiltered ||
                  ia.ownerPersonId ===
                    personFilter),
            );
            const {
              splits: bucketSplits,
              splitGrowth,
            } = computeAccountSplits(bucketAccts);
            const acctItems: TooltipLineItem[] =
              bucketSplits.map((sp) => {
                const subItems: TooltipLineItem[] =
                  [];
                if (sp.contribution > 1)
                  subItems.push({
                    label: "contrib",
                    amount: deflate(
                      sp.contribution,
                      yr.year,
                    ),
                    prefix: "+",
                    color: "green",
                  });
                if (Math.abs(sp.growth) > 1)
                  subItems.push({
                    label: "growth",
                    amount: deflate(
                      sp.growth,
                      yr.year,
                    ),
                    prefix:
                      sp.growth >= 0
                        ? "+"
                        : undefined,
                    color:
                      sp.growth >= 0
                        ? "blue"
                        : "red",
                  });
                return {
                  label: sp.name,
                  amount: deflate(
                    sp.balance,
                    yr.year,
                  ),
                  taxType: itemTaxType(
                    sp.category,
                    sp.taxType,
                  ),
                  sub:
                    subItems.length > 0
                      ? subItems
                      : undefined,
                };
              });
            const deflatedBal = deflate(
              bal,
              yr.year,
            );
            const {
              displayChange,
              displayContrib,
              displayGrowth,
              boyBal,
            } = computeColumnChange({
              deflate,
              bal,
              year: yr.year,
              prev: prevYr
                ? {
                    bal: prevBucketBal,
                    year: prevYr.year,
                  }
                : null,
              splitContrib,
              splitGrowth,
            });
            const changeParts: {
              label: string;
              amount: number;
              color: TipColor;
            }[] = [];
            if (displayContrib > 0)
              changeParts.push({
                label: "contrib",
                amount: displayContrib,
                color: "green",
              });
            if (Math.abs(displayGrowth) > 1)
              changeParts.push({
                label: "growth",
                amount: displayGrowth,
                color:
                  displayGrowth >= 0
                    ? "blue"
                    : "red",
              });
            const tooltipContent =
              acctItems.length > 0
                ? renderTooltip({
                    kind: "money",
                    header: `${taxTypeLabel(bucket)}: ${pct}% of portfolio`,
                    meta: `${yr.year} · ${formatPercent(yr.returnRate, 1)} return${yr.proRateFraction != null && yr.proRateFraction > 0 ? ` (${formatPercent(yr.annualizedReturnRate, 1)} annual)` : ""}`,
                    meta2: `BoY: ${formatCurrency(boyBal)} → EoY: ${formatCurrency(deflatedBal)}`,
                    items: acctItems,
                    yearChange: {
                      total: deflatedBal,
                      change: displayChange,
                      parts:
                        changeParts.length > 0
                          ? changeParts
                          : undefined,
                    },
                    proRate:
                      yr.proRateFraction !=
                        null &&
                      yr.proRateFraction > 0
                        ? {
                            months: proRateMonths(
                              yr.proRateFraction,
                            ),
                            annualAmount: deflate(
                              safeDivide(
                                splitContrib,
                                yr.proRateFraction,
                              ),
                              yr.year,
                            ),
                            proRatedAmount:
                              deflate(
                                splitContrib,
                                yr.year,
                              ),
                          }
                        : undefined,
                    legend: [
                      {
                        label:
                          "Green = contributions",
                        color: "green",
                      },
                      {
                        label: "Blue = growth",
                        color: "blue",
                      },
                    ],
                  })
                : undefined;
            return (
              <Tooltip
                key={bucket}
                content={tooltipContent}
                side="top"
              >
                <td
                  className={`text-right py-1.5 px-2 ${taxTypeTextColor(bucket)}`}
                >
                  {formatCurrency(
                    deflate(bal, yr.year),
                  )}
                </td>
              </Tooltip>
            );
          })
      ) : (
        <>
          {getAccountSegments()
            .map((seg) => ({
              key: seg.key,
              val: getSegmentBalance(
                yr.balanceByAccount,
                seg,
              ),
              color: accountTextColor(
                seg.category,
              ),
              label: seg.label,
            }))
            .filter((col) =>
              visibleColumns.balanceAccts.has(
                col.key,
              ),
            )
            .map((col) => {
              const catKey = colKeyParts(
                col.key,
              ).category;
              const bal = pt
                ? (pt.byAccount[col.key] ?? 0)
                : col.val;
              const totalBal = pt
                ? pt.balance
                : yr.endBalance;
              const pct = pctOf(bal, totalBal);
              // Filter by the exact taxType this column represents
              const colTaxType = colEngineTaxType(
                col.key,
              );
              // Use engine's individualAccountBalances — includes all accounts
              // (not just snapshot), so contributions to new tax types appear.
              const colIabs = (
                yr.individualAccountBalances ?? []
              ).filter(
                (ia) =>
                  ia.category === catKey &&
                  (colTaxType == null ||
                    ia.taxType === colTaxType) &&
                  (!isPersonFiltered ||
                    ia.ownerPersonId ===
                      personFilter),
              );
              // Get previous year's value for this column from the engine
              const colPrevYr =
                result.projectionByYear.find(
                  (y) => y.year === yr.year - 1,
                );
              const colPrevPt = colPrevYr
                ? getPersonYearTotals(colPrevYr)
                : null;
              const colPrevVal = colPrevYr
                ? colPrevPt
                  ? (colPrevPt.byAccount[
                      col.key
                    ] ?? 0)
                  : colBalance(
                      colPrevYr.balanceByAccount,
                      col.key,
                    )
                : 0;
              // splitContrib from authoritative slot data (mirrors engine balance routing)
              const colSplitContrib =
                slotsColumnBalanceInflow(
                  yr.slots,
                  col.key,
                );
              // Per-account splits for balance/growth detail
              const {
                splits,
                splitGrowth: colSplitGrowth,
              } = computeAccountSplits(colIabs);
              const colSplitsTotal =
                splits.reduce(
                  (s, sp) => s + sp.balance,
                  0,
                );
              // Total change = difference of deflated balances (matches table rows)
              const {
                displayChange: colDisplayChange,
                displayContrib: colDisplayContrib,
                displayGrowth: colDisplayGrowth,
                boyBal: colBoyBal,
              } = computeColumnChange({
                deflate,
                bal,
                year: yr.year,
                prev: colPrevYr
                  ? {
                      bal: colPrevVal,
                      year: colPrevYr.year,
                    }
                  : null,
                splitContrib: colSplitContrib,
                splitGrowth: colSplitGrowth,
              });
              const colDeflatedBal = deflate(
                bal,
                yr.year,
              );
              const tooltipContent =
                splits.length > 0
                  ? (() => {
                      const colChangeParts: {
                        label: string;
                        amount: number;
                        color: TipColor;
                      }[] = [];
                      if (colDisplayContrib > 0)
                        colChangeParts.push({
                          label: "contrib",
                          amount:
                            colDisplayContrib,
                          color: "green",
                        });
                      if (
                        Math.abs(
                          colDisplayGrowth,
                        ) > 1
                      )
                        colChangeParts.push({
                          label: "growth",
                          amount:
                            colDisplayGrowth,
                          color:
                            colDisplayGrowth >= 0
                              ? "blue"
                              : "red",
                        });
                      const splitItems: TooltipLineItem[] =
                        splits.map(
                          ({
                            name: acctName,
                            taxType: spTaxType,
                            balance: spBal,
                            contribution:
                              spContrib,
                            growth: spGrowth,
                          }) => {
                            const entryPct =
                              pctOf(
                                spBal,
                                colSplitsTotal,
                              );
                            const subItems: TooltipLineItem[] =
                              [];
                            if (spContrib > 1)
                              subItems.push({
                                label: "contrib",
                                amount: deflate(
                                  spContrib,
                                  yr.year,
                                ),
                                prefix: "+",
                                color: "green",
                              });
                            if (
                              Math.abs(spGrowth) >
                              1
                            )
                              subItems.push({
                                label: "growth",
                                amount: deflate(
                                  spGrowth,
                                  yr.year,
                                ),
                                prefix:
                                  spGrowth >= 0
                                    ? "+"
                                    : undefined,
                                color:
                                  spGrowth >= 0
                                    ? "blue"
                                    : "red",
                              });
                            return {
                              label: acctName,
                              amount: deflate(
                                spBal,
                                yr.year,
                              ),
                              pct: entryPct,
                              taxType:
                                itemTaxType(
                                  catKey,
                                  spTaxType,
                                ),
                              sub:
                                subItems.length >
                                0
                                  ? subItems
                                  : undefined,
                            };
                          },
                        );
                      return renderTooltip({
                        kind: "money",
                        header: `${col.label}: ${pct}% of portfolio`,
                        meta: `${yr.year} · BoY: ${formatCurrency(colBoyBal)} → EoY: ${formatCurrency(colDeflatedBal)} · ${formatPercent(yr.returnRate, 1)} return${yr.proRateFraction != null && yr.proRateFraction > 0 ? ` (${formatPercent(yr.annualizedReturnRate, 1)} annual)` : ""}`,
                        items: splitItems,
                        yearChange: {
                          total: colDeflatedBal,
                          change:
                            colDisplayChange,
                          parts:
                            colChangeParts.length >
                            0
                              ? colChangeParts
                              : undefined,
                        },
                        legend: [
                          {
                            label:
                              "Green = contributions",
                            color: "green",
                          },
                          {
                            label:
                              "Blue = growth",
                            color: "blue",
                          },
                        ],
                      });
                    })()
                  : undefined;
              return (
                <Tooltip
                  key={col.key}
                  content={tooltipContent}
                  side="top"
                >
                  <td
                    className={`text-right py-1.5 px-2 ${col.color}`}
                  >
                    {formatCurrency(
                      deflate(bal, yr.year),
                    )}
                  </td>
                </Tooltip>
              );
            })}
        </>
      )}
      <Tooltip
        content={
          yr.endBalance > 0
            ? (() => {
                const ptBal = pt
                  ? pt.balance
                  : yr.endBalance;
                const items: TooltipLineItem[] = (
                  [
                    "preTax",
                    "taxFree",
                    "hsa",
                    "afterTax",
                  ] as const
                ).map((b) => {
                  const bVal = pt
                    ? pt.byTaxType[b]
                    : yr.balanceByTaxType[b];
                  return {
                    label: taxTypeLabel(b),
                    amount: deflate(
                      bVal,
                      yr.year,
                    ),
                    pct: pctOf(bVal, ptBal),
                  };
                });
                return renderTooltip({
                  kind: "money",
                  header: "Portfolio Balance",
                  items,
                  proRate:
                    yr.proRateFraction != null
                      ? (() => {
                          const totalAnnual =
                            contribSpecs?.reduce(
                              (s, sp) =>
                                s +
                                (sp.baseAnnual ||
                                  0),
                              0,
                            ) ?? 0;
                          return totalAnnual > 0
                            ? {
                                months:
                                  proRateMonths(
                                    yr.proRateFraction,
                                  ),
                                annualAmount:
                                  deflate(
                                    totalAnnual,
                                    yr.year,
                                  ),
                                proRatedAmount:
                                  deflate(
                                    yr.totalEmployee,
                                    yr.year,
                                  ),
                              }
                            : undefined;
                        })()
                      : undefined,
                });
              })()
            : undefined
        }
        side="top"
      >
        <td className="text-right py-1.5 px-2 font-semibold">
          {formatCurrency(
            deflate(
              pt ? pt.balance : yr.endBalance,
              yr.year,
            ),
          )}
        </td>
      </Tooltip>
      {renderMcCell(
        yr,
        deflate(
          pt ? pt.balance : yr.endBalance,
          yr.year,
        ),
        mcCellOpts,
      )}
      <td className="py-1.5 pl-2 text-[10px] text-faint whitespace-nowrap border-l border-subtle">
        {yr.proRateFraction != null && (
          <Tooltip
            content={`Partial year — only ${proRateMonths(yr.proRateFraction)} months remain. All dollar values in this row show what's left for the year, not a full 12-month amount.`}
            side="left"
            maxWidth={240}
          >
            <span className="text-blue-500">
              {proRateMonths(yr.proRateFraction)}
              /12 mo remaining
            </span>
          </Tooltip>
        )}
        {yr.overflowToBrokerage > 0 && (
          <Tooltip
            content={`Contributions exceeded tax-advantaged limits by ${formatCurrency(deflate(yr.overflowToBrokerage, yr.year))} — excess routed to brokerage`}
            side="left"
            maxWidth={240}
          >
            <span className="text-amber-600">
              ↗{""}
              {formatCurrency(
                deflate(
                  yr.overflowToBrokerage,
                  yr.year,
                ),
              )}
              {""}
              overflow
            </span>
          </Tooltip>
        )}
        {yr.warnings.length > 0 && (
          <Tooltip
            content={renderTooltip({
              kind: "info",
              lines: yr.warnings.map((w) => ({
                text: w,
                style: "note" as const,
              })),
            })}
            side="left"
          >
            <span className="text-amber-500 ml-1">
              {yr.warnings.length} warning
              {yr.warnings.length > 1 ? "s" : ""}
            </span>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
