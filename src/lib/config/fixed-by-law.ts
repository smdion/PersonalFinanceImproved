/**
 * The figures Ledgr's math assumes that are set by law and not indexed —
 * they change only when Congress changes them, so they live in code (each
 * cited where it's defined) rather than in the yearly tax data. Settings →
 * Reference Data → Fixed by law lists them read-only, so everything the
 * calculators assume can be seen in one place.
 *
 * Values are read from the constants the calculators use, never retyped
 * here; tests/config/fixed-by-law.test.ts pins each to the law, so a change
 * is deliberate. Statutory figures that live in the yearly tax data instead
 * (the senior deduction, the HSA catch-up, the capital-gains rates in the
 * LTCG table) are editable there and not repeated here.
 */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_AGE,
  HSA_NON_MEDICAL_PENALTY_RATE,
  PENALTY_FREE_AGE,
  QCD_MIN_ELIGIBILITY_AGE,
  RMD_EXCISE_TAX_RATE,
  ROTH_CONVERSION_SEASONING_YEARS,
  RULE_OF_55_AGE,
  ADDITIONAL_STANDARD_DEDUCTION_AGE,
  MEDICARE_START_AGE,
} from "@/lib/constants";
import { NIIT_RATE, NIIT_THRESHOLDS } from "./niit";
import {
  SS_TAX_THRESHOLDS,
  SS_TAX_TIER1_INCLUSION_RATE,
  SS_TAX_TIER2_INCLUSION_RATE,
} from "./ss-tax";
import { getRmdStartAge } from "./rmd-tables";
import {
  ROTH_IRA_MFS_PHASEOUT,
  ROTH_IRA_REDUCED_LIMIT_FLOOR,
  ROTH_IRA_REDUCED_LIMIT_ROUNDING,
} from "./tax-params";
import {
  SS_EARLIEST_CLAIMING_AGE_MONTHS,
  SS_LATEST_CLAIMING_AGE_MONTHS,
  getFullRetirementAge,
} from "./social-security";
import { ACCOUNT_TYPE_CONFIG } from "./account-types";

type FixedByLawItem = {
  label: string;
  value: string;
  /** The law (or regulation) that sets it. */
  citation: string;
};
type FixedByLawGroup = { label: string; items: FixedByLawItem[] };

const money = (n: number) => formatCurrency(n, 0);
const pct = (r: number) =>
  formatPercent(r, Number.isInteger(Math.round(r * 1e6) / 1e4) ? 0 : 1);
/** 59.5 → "59½". */
const age = (a: number) => (a % 1 === 0.5 ? `${Math.floor(a)}½` : `${a}`);
const byStatus = (t: { MFJ: number; Single: number; HOH: number }) =>
  `${money(t.MFJ)} married filing jointly · ${money(t.Single)} single · ${money(t.HOH)} head of household`;
const fra = (y: number) => {
  const f = getFullRetirementAge(y);
  return f.months ? `${f.years} and ${f.months} months` : `${f.years}`;
};

type AccountConfig =
  (typeof ACCOUNT_TYPE_CONFIG)[keyof typeof ACCOUNT_TYPE_CONFIG];

/** One entry per IRS limit group (401k and 403b share one), e.g.
 *  "401k 50 · IRA 50 · HSA 55" — read from the account config. */
function catchupAges(age: (c: AccountConfig) => string | null): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of Object.values(ACCOUNT_TYPE_CONFIG)) {
    const a = age(c);
    if (!a || !c.irsLimitGroup || seen.has(c.irsLimitGroup)) continue;
    seen.add(c.irsLimitGroup);
    parts.push(`${c.displayLabel} ${a}`);
  }
  return parts.join(" · ");
}

export function fixedByLawGroups(): FixedByLawGroup[] {
  return [
    {
      label: "Investment income",
      items: [
        {
          label: "Net investment income tax",
          value: pct(NIIT_RATE),
          citation: "IRC §1411(a)",
        },
        {
          label: "Net investment income tax applies above (MAGI)",
          value: byStatus(NIIT_THRESHOLDS),
          citation: "IRC §1411(b) — not indexed",
        },
      ],
    },
    {
      label: "Social Security",
      items: [
        {
          label: "Benefits taxable: up to 50% above",
          value: `${money(SS_TAX_THRESHOLDS.MFJ.tier1)} married filing jointly · ${money(SS_TAX_THRESHOLDS.Single.tier1)} single / head of household`,
          citation: "IRC §86(c) — not indexed",
        },
        {
          label: "Benefits taxable: up to 85% above",
          value: `${money(SS_TAX_THRESHOLDS.MFJ.tier2)} married filing jointly · ${money(SS_TAX_THRESHOLDS.Single.tier2)} single / head of household`,
          citation: "IRC §86(c) — not indexed",
        },
        {
          label: "Share of benefits taxable (the two tiers)",
          value: `${pct(SS_TAX_TIER1_INCLUSION_RATE)} / ${pct(SS_TAX_TIER2_INCLUSION_RATE)}`,
          citation: "IRC §86(a)",
        },
        {
          label: "Full retirement age",
          value: `${fra(1954)} (born 1943–1954), rising to ${fra(1960)} (born 1960 or later)`,
          citation: "Social Security Act §216(l)",
        },
        {
          label: "Claiming ages",
          value: `${SS_EARLIEST_CLAIMING_AGE_MONTHS / 12} earliest; delayed credits stop at ${SS_LATEST_CLAIMING_AGE_MONTHS / 12}`,
          citation: "Social Security Act §202(a), §202(w)",
        },
      ],
    },
    {
      label: "Ages",
      items: [
        {
          label: "Catch-up contributions from",
          value: catchupAges((c) => (c.catchupAge ? `${c.catchupAge}` : null)),
          citation:
            "IRC §414(v) (workplace plans), §219(b)(5)(B) (IRAs), §223(b)(3) (HSAs)",
        },
        {
          label: "Super catch-up contributions",
          value: catchupAges((c) =>
            c.superCatchupAgeRange
              ? `${c.superCatchupAgeRange[0]}–${c.superCatchupAgeRange[1]}`
              : null,
          ),
          citation: "IRC §414(v)(2)(E) (SECURE 2.0 §109)",
        },
        {
          label: "Penalty-free retirement withdrawals from",
          value: age(PENALTY_FREE_AGE),
          citation: "IRC §72(t)(2)(A)(i)",
        },
        {
          label: "Rule of 55 (leaving an employer's plan)",
          value: `${RULE_OF_55_AGE}`,
          citation: "IRC §72(t)(2)(A)(v)",
        },
        {
          label: "Additional standard deduction from",
          value: `${ADDITIONAL_STANDARD_DEDUCTION_AGE}`,
          citation: "IRC §63(f)",
        },
        {
          label: "Medicare (and IRMAA) from",
          value: `${MEDICARE_START_AGE}`,
          citation: "Social Security Act §226",
        },
        {
          label: "HSA non-medical withdrawals penalty-free from",
          value: `${HSA_NON_MEDICAL_PENALTY_AGE}`,
          citation: "IRC §223(f)(4)(C)",
        },
        {
          label: "Charitable distributions (QCDs) from IRAs",
          value: `70½ (Ledgr counts from the year you turn ${QCD_MIN_ELIGIBILITY_AGE})`,
          citation: "IRC §408(d)(8)(B)(ii)",
        },
        {
          label: "Required minimum distributions start",
          value: `${getRmdStartAge(1950)} (born 1950 or earlier) · ${getRmdStartAge(1959)} (born 1951–1959) · ${getRmdStartAge(1960)} (born 1960 or later)`,
          citation: "IRC §401(a)(9)(C) (SECURE 2.0 §107)",
        },
      ],
    },
    {
      label: "Penalties and rules",
      items: [
        {
          label: "Early withdrawal penalty",
          value: pct(EARLY_WITHDRAWAL_PENALTY_RATE),
          citation: "IRC §72(t)(1)",
        },
        {
          label: "HSA non-medical withdrawal penalty",
          value: pct(HSA_NON_MEDICAL_PENALTY_RATE),
          citation: "IRC §223(f)(4)(A)",
        },
        {
          label: "Missed required distribution (excise tax)",
          value: pct(RMD_EXCISE_TAX_RATE),
          citation: "IRC §4974(a) (SECURE 2.0 §302)",
        },
        {
          label: "Roth conversion waiting period (before age 59½)",
          value: `${ROTH_CONVERSION_SEASONING_YEARS} years`,
          citation: "IRC §408A(d)(3)(F)",
        },
        {
          label: "Reduced Roth IRA limit",
          value: `rounded up to the next ${money(ROTH_IRA_REDUCED_LIMIT_ROUNDING)}, at least ${money(ROTH_IRA_REDUCED_LIMIT_FLOOR)}`,
          citation: "IRC §408A(c)(3)(A); Pub. 590-A",
        },
        {
          label: "Roth IRA phase-out, married filing separately",
          value: `${money(ROTH_IRA_MFS_PHASEOUT.start)}–${money(ROTH_IRA_MFS_PHASEOUT.end)}`,
          citation: "IRC §408A(c)(3)(B) — not indexed",
        },
      ],
    },
  ];
}
