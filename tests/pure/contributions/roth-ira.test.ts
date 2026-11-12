import { describe, it, expect } from "vitest";
import {
  buildRothIraView,
  backdoorPlanned,
} from "@/lib/pure/contributions/roth-ira";
import {
  judgeRothIra,
  rothIraAllowed,
} from "@/lib/pure/contributions/roth-ira-judge";
import {
  pendingConversion,
  preTaxIraByPerson,
} from "@/lib/pure/contributions/roth-ira-pro-rata";
import {
  otherIraMoney,
  rothIraSummary,
} from "@/lib/pure/contributions/roth-ira-summary";
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
    {
      personId: 1,
      name: "A",
      compensation: 150_000,
      iraLimit: 7000,
      otherIraContributions: 0,
    },
    {
      personId: 2,
      name: "B",
      compensation: 0,
      iraLimit: 8000,
      otherIraContributions: 0,
    },
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
        {
          personId: 1,
          name: "A",
          compensation: 8000,
          iraLimit: 7000,
          otherIraContributions: 0,
        },
        {
          personId: 2,
          name: "B",
          compensation: 0,
          iraLimit: 7000,
          otherIraContributions: 0,
        },
      ],
    })!;
    expect(r.people.map((p) => p.maxDirect)).toEqual([7000, 1000]);
  });

  it("reads the cap pass's IRA room when given: the spouse's actual IRA money counts (IRC 219(c))", () => {
    // A puts 2,000 into an IRA, so of the couple's 8,000 compensation B can
    // use 6,000 — what the cap pass reports, not a higher-earner-first split.
    const r = judgeRothIra({
      magi: 50_000,
      phaseOut: MFJ,
      marginOverride: null,
      combinedCompensation: true,
      people: [
        {
          personId: 1,
          name: "A",
          compensation: 8000,
          iraLimit: 7000,
          iraRoom: 2000,
          otherIraContributions: 0,
        },
        {
          personId: 2,
          name: "B",
          compensation: 0,
          iraLimit: 7000,
          iraRoom: 6000,
          otherIraContributions: 0,
        },
      ],
    })!;
    expect(r.people.map((p) => p.maxDirect)).toEqual([2000, 6000]);
  });

  it("traditional IRA money this year comes off the Roth room (Worksheet 2-2 lines 9–11)", () => {
    const one = (magi: number, other: number) =>
      judgeRothIra({
        magi,
        phaseOut: MFJ,
        marginOverride: null,
        combinedCompensation: false,
        people: [
          {
            personId: 1,
            name: "A",
            compensation: 150_000,
            iraLimit: 7000,
            otherIraContributions: other,
          },
        ],
      })!.people[0]!.maxDirect;
    // Under the range: 7,000 − 2,000.
    expect(one(150_000, 2000)).toBe(5000);
    // Halfway: line 8 is 3,500; line 10 is 7,000 − 2,000 = 5,000; 3,500.
    expect(one(205_000, 2000)).toBe(3500);
    // Line 10 smaller: 7,000 − 6,000 = 1,000 (no $200 floor on line 10).
    expect(one(205_000, 6000)).toBe(1000);
    expect(one(150_000, 9000)).toBe(0);
  });

  it("a spouse's traditional IRA money leaves less of the couple's pay (IRC 219(c))", () => {
    // A: 8,000 pay, 3,000 traditional, 4,000 Roth room left. B: no pay,
    // 8,000 − 3,000 − 4,000 = 1,000.
    const r = judgeRothIra({
      magi: 50_000,
      phaseOut: MFJ,
      marginOverride: null,
      combinedCompensation: true,
      people: [
        {
          personId: 1,
          name: "A",
          compensation: 8000,
          iraLimit: 7000,
          otherIraContributions: 3000,
        },
        {
          personId: 2,
          name: "B",
          compensation: 0,
          iraLimit: 7000,
          otherIraContributions: 0,
        },
      ],
    })!;
    expect(r.people.map((p) => p.maxDirect)).toEqual([4000, 1000]);
  });

  it("with no cap-pass room, the higher earner is held to their own pay (IRC 219(c)(2))", () => {
    const allowed = (pays: [number, number]) =>
      judgeRothIra({
        magi: 50_000,
        phaseOut: MFJ,
        marginOverride: null,
        combinedCompensation: true,
        people: [
          {
            personId: 1,
            name: "A",
            compensation: pays[0],
            iraLimit: 7500,
            otherIraContributions: 0,
          },
          {
            personId: 2,
            name: "B",
            compensation: pays[1],
            iraLimit: 7500,
            otherIraContributions: 0,
          },
        ],
      })!.people.map((p) => p.maxDirect);
    // A: own 5,000. B: 3,000 + 5,000 − 5,000 = 3,000.
    expect(allowed([5000, 3000])).toEqual([5000, 3000]);
    // Equal pay: neither has less, so each is held to their own.
    expect(allowed([4000, 4000])).toEqual([4000, 4000]);
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
  it("MAGI = AGI (HSA outside payroll already off) + investment income; MFJ uses combined pay", () => {
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
            iraRoom: null,
            rothRoute: null,
          },
          {
            personId: 2,
            name: "B",
            compensation: 0,
            iraLimit: null,
            hasEmployerPlan: false,
            iraRoom: null,
            rothRoute: null,
          },
        ],
      },
      // Wages 190,000 less 1,000 paid into an HSA outside payroll.
      wageAgi: 189_000,
      investmentIncome: 16_000,
      preTaxIraByPerson: [{ personId: 1, amount: 1234 }],
      otherIraByPerson: [{ personId: 1, amount: 0 }],
      marginOverride: null,
    });
    expect(v.magi).toBe(205_000);
    // Each person's other IRA money reaches the judge: under the range,
    // 7,000 less 5,000 of traditional money.
    expect(
      buildRothIraView({
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
              iraRoom: null,
              rothRoute: null,
            },
          ],
        },
        wageAgi: 150_000,
        investmentIncome: 0,
        preTaxIraByPerson: [],
        otherIraByPerson: [{ personId: 1, amount: 5000 }],
        marginOverride: null,
      }).judgement!.people[0]!.maxDirect,
    ).toBe(2000);
    expect(v.judgement!.verdict).toBe("tooClose");
    // A person whose IRA limit is missing from the data is left out.
    expect(v.judgement!.people.map((p) => p.personId)).toEqual([1]);
    expect(v.proRata).toEqual([
      { personId: 1, name: "A", amount: 1234, hasEmployerPlan: true },
    ]);
  });

  it("a judged person with no line 9 entry is refused, never read as $0", () => {
    expect(() =>
      buildRothIraView({
        rothIra: {
          filingStatus: "Single",
          phaseOut: MFJ,
          people: [
            {
              personId: 1,
              name: "A",
              compensation: 100_000,
              iraLimit: 7000,
              hasEmployerPlan: false,
              iraRoom: null,
              rothRoute: null,
            },
          ],
        },
        wageAgi: 100_000,
        investmentIncome: 0,
        preTaxIraByPerson: [],
        otherIraByPerson: [],
        marginOverride: null,
      }),
    ).toThrow("no line 9 for person 1");
  });
});

describe("otherIraMoney", () => {
  it("sums the capped money of non-Roth IRA rows; Roth IRA and 401(k) rows don't count", () => {
    const cap = (cappedAnnual: number) => ({ cappedAnnual });
    expect(
      otherIraMoney([
        { accountType: "ira", taxTreatment: "pre_tax", cap: cap(2000) },
        { accountType: "ira", taxTreatment: "after_tax", cap: cap(500) },
        { accountType: "ira", taxTreatment: "tax_free", cap: cap(7000) },
        { accountType: "401k", taxTreatment: "pre_tax", cap: cap(9000) },
      ]),
    ).toBe(2500);
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
        iraRoom: null,
        rothRoute: null,
      },
      // An HSA isn't a plan that takes IRA roll-ins.
      {
        personId: 2,
        name: "B",
        compensation: 0,
        iraLimit: 7000,
        hasEmployerPlan: false,
        iraRoom: null,
        rothRoute: null,
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
            iraRoom: null,
            rothRoute: null,
          },
        ],
      },
      wageAgi: 220_000,
      investmentIncome: 0,
      preTaxIraByPerson: [{ personId: 1, amount }],
      otherIraByPerson: [{ personId: 1, amount: 0 }],
      marginOverride: null,
    });
  it("leftover cents aren't a pro-rata blocker; a real balance is", () => {
    expect(view(0.12).proRata).toEqual([]);
    expect(view(69).proRata).toEqual([]); // under 1% of the $7,000 limit
    expect(view(70).proRata).toHaveLength(1);
    expect(view(5000, null).proRata).toEqual([]); // limit unknown
  });
});

describe("Roth IRA route", () => {
  it("rothIraRouteOf: the Roth IRA contribution's route, absent = direct; null with none", async () => {
    const { rothIraRouteOf } =
      await import("@/lib/pure/contributions/roth-ira");
    expect(
      rothIraRouteOf([
        { accountType: "401k", taxTreatment: "tax_free" },
        { accountType: "ira", taxTreatment: "tax_free" },
      ]),
    ).toBe("direct");
    expect(
      rothIraRouteOf([
        { accountType: "ira", taxTreatment: "tax_free", rothRoute: "backdoor" },
      ]),
    ).toBe("backdoor");
    // A traditional IRA contribution isn't a Roth route.
    expect(
      rothIraRouteOf([{ accountType: "ira", taxTreatment: "pre_tax" }]),
    ).toBeNull();
  });

  it("backdoorPlanned: the verdict, or anyone's route", () => {
    const v = (verdictMagi: number, route: "direct" | "backdoor" | null) =>
      buildRothIraView({
        rothIra: {
          filingStatus: "MFJ",
          phaseOut: MFJ,
          people: [
            {
              personId: 1,
              name: "A",
              compensation: 150_000,
              iraLimit: 7000,
              hasEmployerPlan: true,
              iraRoom: null,
              rothRoute: route,
            },
          ],
        },
        wageAgi: verdictMagi,
        investmentIncome: 0,
        preTaxIraByPerson: [],
        otherIraByPerson: [{ personId: 1, amount: 0 }],
        marginOverride: null,
      });
    expect(backdoorPlanned(v(150_000, "direct"))).toBe(false);
    expect(backdoorPlanned(v(150_000, "backdoor"))).toBe(true);
    expect(backdoorPlanned(v(220_000, null))).toBe(true);
  });
});

describe("pendingConversion", () => {
  const b = (day: string, balance: number) => ({ day, balance });
  it("the deposit since the last conversion", () => {
    expect(
      pendingConversion(
        [
          b("2026-10-02", 625.19),
          b("2026-10-06", 0.19),
          b("2026-10-31", 625.19),
        ],
        "2026-11-01",
        "2026-09-17",
      ),
    ).toBe(625);
  });
  it("nothing after it's converted", () => {
    expect(
      pendingConversion(
        [b("2026-10-31", 625.19), b("2026-11-05", 0.19)],
        "2026-11-06",
        "2026-09-22",
      ),
    ).toBe(0);
  });
  it("too little history: nothing", () => {
    expect(
      pendingConversion([b("2026-10-31", 625)], "2026-11-01", "2026-09-17"),
    ).toBe(0);
  });
});
