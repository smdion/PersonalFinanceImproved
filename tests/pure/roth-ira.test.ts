import { describe, it, expect } from "vitest";
import {
  buildRothIraView,
  judgeRothIra,
  preTaxIraByPerson,
  rothIraAllowed,
  rothIraSummary,
  backdoorPlanned,
} from "@/lib/pure/roth-ira";
import {
  medicareLiabilityKey,
  rothIraPhaseoutKeys,
} from "@/lib/config/tax-params";

// Fictional phase-out ranges (passed in as the router reads them from data).
const MFJ = { start: 200_000, end: 210_000 };
const SINGLE = { start: 120_000, end: 135_000 };

describe("rothIraAllowed (Pub 590-A Worksheet 2-2)", () => {
  it("full limit below the start, nothing at or above the end", () => {
    expect(rothIraAllowed(150_000, MFJ, 7000)).toBe(7000);
    expect(rothIraAllowed(200_000, MFJ, 7000)).toBe(7000);
    expect(rothIraAllowed(210_000, MFJ, 7000)).toBe(0);
  });

  it("reduces linearly, rounding UP to the next $10", () => {
    // 7000 × (203,333 − 200,000) / 10,000 = 2333.1 → 4666.9 → 4670
    expect(rothIraAllowed(203_333, MFJ, 7000)).toBe(4670);
    // Single range width 15k: 7000 × 7500/15000 = 3500 → 3500
    expect(rothIraAllowed(127_500, SINGLE, 7000)).toBe(3500);
  });

  it("reduces the smaller of the limit and compensation (Worksheet 2-2 line 6)", () => {
    // Base 4,000 (compensation) halfway through the range → 2,000.
    expect(rothIraAllowed(205_000, MFJ, 4000)).toBe(2000);
    expect(rothIraAllowed(150_000, MFJ, 0)).toBe(0);
  });

  it("$200 floor for any amount above zero", () => {
    // 7000 × 9,990 / 10,000 = 6993 → 7 → 10 → floored to 200
    expect(rothIraAllowed(209_990, MFJ, 7000)).toBe(200);
  });
});

describe("judgeRothIra", () => {
  const people = [
    { personId: 1, name: "A", compensation: 150_000, iraLimit: 7000 },
    { personId: 2, name: "B", compensation: 0, iraLimit: 8000 },
  ];
  const judge = (magi: number, over = {}) =>
    judgeRothIra({
      magi,
      phaseOut: MFJ,
      marginOverride: null,
      combinedCompensation: true,
      people,
      ...over,
    })!;

  it("direct only below start − margin (default margin = range width)", () => {
    expect(judge(189_999).verdict).toBe("direct");
    expect(judge(190_000).verdict).toBe("tooClose");
    expect(judge(190_000).margin).toBe(10_000);
  });

  it("the household margin overrides the default", () => {
    expect(judge(195_000, { marginOverride: 2_000 }).verdict).toBe("direct");
  });

  it("inside the range: too close, with each person's partial amount", () => {
    const r = judge(205_000);
    expect(r.verdict).toBe("tooClose");
    expect(r.people.map((p) => p.maxDirect)).toEqual([3500, 4000]);
  });

  it("at or above the end: backdoor, nothing direct", () => {
    const r = judge(210_000);
    expect(r.verdict).toBe("backdoor");
    expect(r.people.every((p) => p.maxDirect === 0)).toBe(true);
  });

  it("a spouse with no pay can contribute from combined pay (MFJ) but not otherwise", () => {
    expect(judge(150_000).people[1]!.maxDirect).toBe(8000);
    expect(
      judge(150_000, { combinedCompensation: false }).people[1]!.maxDirect,
    ).toBe(0);
  });

  it("together the spouses never pass the couple's combined compensation", () => {
    const r = judgeRothIra({
      magi: 50_000,
      phaseOut: MFJ,
      marginOverride: null,
      combinedCompensation: true,
      people: [
        { personId: 1, name: "A", compensation: 8000, iraLimit: 7000 },
        { personId: 2, name: "B", compensation: 0, iraLimit: 7000 },
      ],
    })!;
    expect(r.people.map((p) => p.maxDirect)).toEqual([7000, 1000]);
  });

  it("no phase-out data → no verdict", () => {
    expect(judge(150_000, { phaseOut: null })).toBeNull();
  });
});

describe("preTaxIraByPerson", () => {
  it("sums pre-tax IRA money per owner; 401(k) and Roth IRA don't count", () => {
    const m = preTaxIraByPerson([
      { accountType: "ira", taxType: "preTax", ownerPersonId: 1, amount: 500 },
      { accountType: "ira", taxType: "preTax", ownerPersonId: 1, amount: 250 },
      { accountType: "ira", taxType: "taxFree", ownerPersonId: 1, amount: 9 },
      { accountType: "401k", taxType: "preTax", ownerPersonId: 1, amount: 9 },
      { accountType: "ira", taxType: "preTax", ownerPersonId: 2, amount: 0 },
      { accountType: "ira", taxType: "preTax", ownerPersonId: null, amount: 9 },
    ]);
    expect([...m.byPerson]).toEqual([[1, 750]]);
    expect(m.unowned).toBe(9);
  });
});

describe("buildRothIraView", () => {
  it("MAGI = wage AGI − HSA outside payroll + investment income; MFJ uses combined pay", () => {
    const v = buildRothIraView({
      rothIra: {
        filingStatus: "MFJ",
        phaseOut: MFJ,
        people: [
          {
            personId: 1,
            name: "A",
            compensation: 190_000,
            iraLimit: 7000,
            hasEmployerPlan: true,
          },
          {
            personId: 2,
            name: "B",
            compensation: 0,
            iraLimit: null,
            hasEmployerPlan: false,
          },
        ],
      },
      wageAgi: 190_000,
      hsaOutsidePayroll: 1_000,
      investmentIncome: 16_000,
      preTaxIraByPerson: [{ personId: 1, amount: 1234 }],
      marginOverride: null,
    });
    expect(v.magi).toBe(205_000);
    expect(v.judgement!.verdict).toBe("tooClose");
    // A person whose IRA limit is missing from the data is left out.
    expect(v.judgement!.people.map((p) => p.personId)).toEqual([1]);
    expect(v.proRata).toEqual([
      { personId: 1, name: "A", amount: 1234, hasEmployerPlan: true },
    ]);
  });
});

describe("rothIraSummary", () => {
  const limits = {
    ira_limit: 7000,
    ira_catchup_limit: 1000,
    roth_ira_phaseout_start_mfj: 200_000,
    roth_ira_phaseout_end_mfj: 210_000,
  };
  const people = [
    {
      personId: 1,
      name: "A",
      birthYear: 1970,
      earnings: { gross: 120_000, preTaxFederal: 20_000 },
      jobAccountTypes: ["401k", "hsa"],
    },
    {
      personId: 2,
      name: "B",
      birthYear: 1990,
      earnings: null,
      jobAccountTypes: ["hsa"],
    },
  ];

  it("phase-out for the filing status; compensation net of pre-tax money; limit by age; employer plan", () => {
    const s = rothIraSummary({
      filingStatus: "MFJ",
      taxYear: 2026,
      limits,
      people,
    })!;
    expect(s.phaseOut).toEqual({ start: 200_000, end: 210_000 });
    expect(s.people).toEqual([
      {
        personId: 1,
        name: "A",
        compensation: 100_000,
        iraLimit: 8000,
        hasEmployerPlan: true,
      },
      // An HSA isn't a plan that takes IRA roll-ins.
      {
        personId: 2,
        name: "B",
        compensation: 0,
        iraLimit: 7000,
        hasEmployerPlan: false,
      },
    ]);
  });

  it("missing rows read softly; no filing status → null", () => {
    const s = rothIraSummary({
      filingStatus: "Single",
      taxYear: 2026,
      limits: {},
      people,
    })!;
    expect(s.phaseOut).toBeNull();
    expect(s.people[0]!.iraLimit).toBeNull();
    expect(
      rothIraSummary({ filingStatus: null, taxYear: 2026, limits, people }),
    ).toBeNull();
  });
});

describe("backdoorPlanned and phase-out keys", () => {
  it("true only for a backdoor verdict", () => {
    expect(backdoorPlanned(null)).toBe(false);
  });
  it("keys follow the filing status, lower-cased", () => {
    expect(rothIraPhaseoutKeys("HOH")).toEqual({
      start: "roth_ira_phaseout_start_hoh",
      end: "roth_ira_phaseout_end_hoh",
    });
    expect(medicareLiabilityKey("MFJ")).toBe(
      "fica_medicare_surtax_liability_mfj",
    );
  });
});

describe("pro-rata materiality", () => {
  const view = (amount: number, iraLimit: number | null = 7000) =>
    buildRothIraView({
      rothIra: {
        filingStatus: "MFJ",
        phaseOut: { start: 200_000, end: 210_000 },
        people: [
          {
            personId: 1,
            name: "A",
            compensation: 150_000,
            iraLimit,
            hasEmployerPlan: true,
          },
        ],
      },
      wageAgi: 220_000,
      hsaOutsidePayroll: 0,
      investmentIncome: 0,
      preTaxIraByPerson: [{ personId: 1, amount }],
      marginOverride: null,
    });
  it("leftover cents aren't a pro-rata blocker; a real balance is", () => {
    expect(view(0.12).proRata).toEqual([]);
    expect(view(69).proRata).toEqual([]); // under 1% of the $7,000 limit
    expect(view(70).proRata).toHaveLength(1);
    expect(view(5000, null).proRata).toEqual([]); // limit unknown
  });
});
