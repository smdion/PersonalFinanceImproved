/** The accumulation row's contribution columns: each category's, the
 *  overflow account's and each tax type's tooltip. */
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  AccumulationSlot,
  EngineAccumulationYear,
} from "@/lib/pure/engine/types";
import type { ProjectionState } from "../projection-table-types";
import type { TooltipLineItem } from "../types";
import {
  getAccountTypeConfig,
  getDisplayConfig,
} from "@/lib/config/account-types";
import {
  itemTaxType,
  matchFracOf,
  proRateMonths,
  specFrac,
} from "./projection-columns";
import { safeDivide } from "@/lib/utils/math";
import { taxTypeLabel } from "@/lib/config/display-labels";

/** One account category's contribution tooltip, per contributing account. */
export function categoryContributionTooltip(
  catSpecs: NonNullable<ProjectionState["contribSpecs"]>,
  isPersonFiltered: ProjectionState["isPersonFiltered"],
  personFilter: ProjectionState["personFilter"],
  specTotal: number,
  rawEmp: number,
  deflate: ProjectionState["deflate"],
  yearRow: EngineAccumulationYear,
  cat: AccountCategory,
  rawMatch: number,
  personFilterName: ProjectionState["personFilterName"],
  emp: number,
  match: number,
  renderTooltip: ProjectionState["renderTooltip"],
  catLabel: string,
  slot: AccumulationSlot | undefined,
) {
  const items: TooltipLineItem[] =
    catSpecs.length > 1
      ? catSpecs
          .filter((sp) => !isPersonFiltered || sp.personId === personFilter)
          .map((sp) => {
            const frac = specFrac({
              baseAnnual: sp.baseAnnual || 0,
              specTotal,
              specCount: catSpecs.length,
            });
            const personEmp = rawEmp * frac;
            const label = sp.ownerName
              ? `${sp.ownerName} (${sp.name})`
              : sp.name;
            const matchTotal = catSpecs.reduce(
              (s2, s2p) => s2 + (s2p.matchAnnual ?? 0),
              0,
            );
            const mFrac = matchFracOf({
              matchAnnual: sp.matchAnnual ?? 0,
              allMatchAnnual: matchTotal,
            });
            return {
              label,
              amount: deflate(personEmp, yearRow.year),
              taxType: itemTaxType(cat, sp.taxTreatment),
              match:
                (sp.matchAnnual ?? 0) > 0
                  ? deflate(rawMatch * mFrac, yearRow.year)
                  : undefined,
              matchLabel: getDisplayConfig(
                cat,
                sp.name !== cat ? sp.name : undefined,
              ).employerMatchLabel,
            };
          })
      : [
          {
            label:
              catSpecs[0]?.ownerName ??
              (isPersonFiltered ? personFilterName : "Employee"),
            amount: deflate(emp, yearRow.year),
            taxType: itemTaxType(cat, catSpecs[0]?.taxTreatment),
            match: match > 0 ? deflate(match, yearRow.year) : undefined,
            matchLabel: getDisplayConfig(
              cat,
              catSpecs[0]?.name !== cat ? catSpecs[0]?.name : undefined,
            ).employerMatchLabel,
          },
        ];
  return renderTooltip({
    kind: "money",
    header: `${catLabel} Contributions`,
    items,
    taxSplit:
      getAccountTypeConfig(cat).supportsRothSplit &&
      slot &&
      (slot.rothContrib > 0 || slot.traditionalContrib > 0)
        ? {
            traditional: deflate(slot.traditionalContrib, yearRow.year),
            roth: deflate(slot.rothContrib, yearRow.year),
          }
        : undefined,
    rateCeiling:
      yearRow.rateCeilingScale != null &&
      yearRow.rateCeilingScale < 1 &&
      yearRow.rateCeilingScale > 0
        ? {
            uncapped: deflate(
              safeDivide(emp, yearRow.rateCeilingScale),
              yearRow.year,
            ),
            capped: deflate(emp, yearRow.year),
            pct: 1 - yearRow.rateCeilingScale,
          }
        : undefined,
    irsLimit: slot
      ? {
          category: catLabel,
          limit: deflate(slot.irsLimit, yearRow.year),
          used: deflate(emp, yearRow.year),
        }
      : undefined,
    proRate:
      yearRow.proRateFraction != null
        ? {
            months: proRateMonths(yearRow.proRateFraction),
            annualAmount: deflate(specTotal, yearRow.year),
            proRatedAmount: deflate(emp, yearRow.year),
          }
        : undefined,
  });
}

/** The overflow account's contribution tooltip, per contributing account. */
export function overflowContributionTooltip(
  ofSpecs: NonNullable<ProjectionState["contribSpecs"]>,
  ofEmp: number,
  ofMatch: number,
  deflate: ProjectionState["deflate"],
  yearRow: EngineAccumulationYear,
  ofCat: AccountCategory,
  renderTooltip: ProjectionState["renderTooltip"],
  ofLabel: string,
) {
  const allMatchAnnual = ofSpecs.reduce(
    (s, sp) => s + (sp.matchAnnual ?? 0),
    0,
  );
  const items: TooltipLineItem[] =
    ofSpecs.length > 0
      ? ofSpecs.map((sp) => {
          const bSpecTotal = ofSpecs.reduce(
            (s, s2) => s + (s2.baseAnnual || 0),
            0,
          );
          const frac = specFrac({
            baseAnnual: sp.baseAnnual || 0,
            specTotal: bSpecTotal,
            specCount: ofSpecs.length,
          });
          const label = sp.ownerName ? `${sp.ownerName} (${sp.name})` : sp.name;
          const personOf = ofEmp * frac;
          const mFrac = matchFracOf({
            matchAnnual: sp.matchAnnual ?? 0,
            allMatchAnnual,
          });
          const spMatch = ofMatch * mFrac;
          return {
            label,
            amount: deflate(personOf, yearRow.year),
            match: spMatch > 0 ? deflate(spMatch, yearRow.year) : undefined,
            matchLabel: getDisplayConfig(
              ofCat,
              sp.name !== ofCat ? sp.name : undefined,
            ).employerMatchLabel,
          };
        })
      : [
          {
            label: "Employee",
            amount: deflate(ofEmp, yearRow.year),
            match: ofMatch > 0 ? deflate(ofMatch, yearRow.year) : undefined,
            matchLabel: getDisplayConfig(ofCat).employerMatchLabel,
          },
        ];
  const ofAnnual = ofSpecs.reduce((s, sp) => s + (sp.baseAnnual || 0), 0);
  return renderTooltip({
    kind: "money",
    header: `${ofLabel} Contributions`,
    items,
    rateCeiling:
      yearRow.rateCeilingScale != null &&
      yearRow.rateCeilingScale > 0 &&
      yearRow.rateCeilingScale < 1
        ? {
            uncapped: deflate(ofEmp / yearRow.rateCeilingScale, yearRow.year),
            capped: deflate(ofEmp, yearRow.year),
            pct: 1 - yearRow.rateCeilingScale,
          }
        : undefined,
    proRate:
      yearRow.proRateFraction != null && ofAnnual > 0
        ? {
            months: proRateMonths(yearRow.proRateFraction),
            annualAmount: deflate(ofAnnual, yearRow.year),
            proRatedAmount: deflate(ofEmp, yearRow.year),
          }
        : undefined,
  });
}

/** One tax type's contribution tooltip. */
export function taxTypeContributionTooltip(
  renderTooltip: ProjectionState["renderTooltip"],
  bucket: "preTax" | "taxFree" | "hsa" | "afterTax",
  items: TooltipLineItem[],
  deflate: ProjectionState["deflate"],
  bucketTotal: number,
  yearRow: EngineAccumulationYear,
  bucketMatch: number,
  bucketAssocMatch: number,
  bucketAnnual: number,
) {
  return renderTooltip({
    kind: "money",
    header: `${taxTypeLabel(bucket)} Contributions`,
    items,
    total:
      items.length > 1
        ? {
            label: "Total",
            amount: deflate(bucketTotal, yearRow.year),
            match:
              bucketMatch + bucketAssocMatch > 0
                ? deflate(bucketMatch + bucketAssocMatch, yearRow.year)
                : undefined,
          }
        : undefined,
    routingNote:
      bucketAssocMatch > 0
        ? `Match flows to ${taxTypeLabel("preTax")}`
        : undefined,
    proRate:
      yearRow.proRateFraction != null && bucketAnnual > 0
        ? {
            months: proRateMonths(yearRow.proRateFraction),
            annualAmount: deflate(bucketAnnual, yearRow.year),
            proRatedAmount: deflate(bucketTotal, yearRow.year),
          }
        : undefined,
  });
}
