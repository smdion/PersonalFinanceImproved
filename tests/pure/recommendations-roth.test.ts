import { describe, it, expect } from "vitest";
import { recommendationsFromRothIra } from "@/lib/pure/recommendations-roth";
import { buildRothIraView } from "@/lib/pure/roth-ira";

// Fictional range (the filing status only names it here).
const view = (
  magi: number,
  preTax = 0,
  hasEmployerPlan = true,
  rothRoute: "direct" | "backdoor" | null = null,
  filingStatus = "MFJ",
) =>
  buildRothIraView({
    rothIra: {
      filingStatus,
      phaseOut: { start: 200_000, end: 210_000 },
      people: [
        {
          personId: 7,
          name: "Ann",
          compensation: 180_000,
          iraLimit: 7000,
          hasEmployerPlan,
          iraRoom: null,
          rothRoute,
        },
      ],
    },
    wageAgi: magi,
    hsaOutsidePayroll: 0,
    investmentIncome: 0,
    preTaxIraByPerson: preTax ? [{ personId: 7, amount: preTax }] : [],
    marginOverride: null,
  });
const recs = (
  v: ReturnType<typeof view> | null,
  taxYear: number,
  today: string,
) => recommendationsFromRothIra(v, taxYear, today);

describe("recommendationsFromRothIra", () => {
  it("nothing when direct is fine, or no view/verdict", () => {
    expect(recs(view(150_000, 5000), 2026, "2026-11-01")).toEqual([]);
    expect(recs(null, 2026, "2026-11-01")).toEqual([]);
  });

  it("backdoor: one Roth item; pro-rata per person with pre-tax IRA money", () => {
    const r = recs(view(220_000, 5000), 2026, "2026-11-01");
    expect(r.map((x) => x.id)).toEqual(["rothIra", "proRata:7"]);
    expect(r[0]!.action).toBe(
      "Use the backdoor Roth — income is over the Roth IRA limit",
    );
    expect(r[1]!.action).toMatch(/Roll Ann's \$5,000 .*workplace plan/);
  });

  it("names the household's own filing status — no hedge about another one", () => {
    const mfj = recs(view(220_000), 2026, "2026-11-01")[0]!;
    expect(mfj.context).toMatch(
      /Married filing jointly: 2026 income \(MAGI\) about \$220,000, phase-out \$200,000–\$210,000/,
    );
    expect(mfj.context).not.toMatch(/separately/);
    const single = recs(
      view(220_000, 0, true, null, "Single"),
      2026,
      "2026-11-01",
    )[0]!;
    expect(single.context).toMatch(/^.*Single: 2026 income/);
    expect(single.context).not.toMatch(/MFJ|jointly|separately/);
  });

  it("the action is one short line; the how goes under it", () => {
    for (const route of [null, "direct"] as const)
      for (const magi of [205_000, 220_000]) {
        const r = recs(view(magi, 0, true, route), 2026, "2026-11-01")[0]!;
        expect(r.action.length).toBeLessThanOrEqual(80);
        expect(r.context).toMatch(/Backdoor: a non-deductible traditional IRA/);
      }
  });

  it("no workplace plan: pro-rata is a warning, not a roll-in suggestion", () => {
    const r = recs(view(220_000, 5000, false), 2026, "2026-11-01");
    expect(r[1]!.action).not.toMatch(/workplace plan/);
    expect(r[1]!.action).toMatch(/mostly taxable/);
    expect(r[1]!.context).toMatch(/Pro-rata rule/);
  });

  it("too close, nothing contributed yet: wait for the year's income or use the backdoor; no pro-rata item without pre-tax IRA money", () => {
    const r = recs(view(205_000), 2026, "2026-11-01");
    expect(r).toHaveLength(1);
    expect(r[0]!.action).toBe(
      "Use the backdoor Roth — income is inside the Roth IRA phase-out",
    );
    expect(r[0]!.context).toMatch(
      /Or wait until the year's income is final .*allowed directly today: Ann \$3,500/,
    );
  });

  it("too close and contributing directly: act now — excess risk, the backdoor, the direct amount allowed", () => {
    const r = recs(view(205_000, 0, true, "direct"), 2026, "2026-11-01");
    expect(r).toHaveLength(1);
    expect(r[0]!.action).toBe(
      "Switch Ann to the backdoor Roth — income is inside the Roth IRA phase-out",
    );
    expect(r[0]!.context).toMatch(
      /Staying direct\? Allowed today: Ann \$3,500; .*recharacterize anything over/,
    );
  });

  it("already using the backdoor: nothing to decide, too close or over", () => {
    expect(
      recs(view(205_000, 0, true, "backdoor"), 2026, "2026-11-01"),
    ).toEqual([]);
    expect(
      recs(view(220_000, 0, true, "backdoor"), 2026, "2026-11-01"),
    ).toEqual([]);
  });

  it("over the limit but contributing directly: switch to the backdoor", () => {
    const r = recs(view(220_000, 0, true, "direct"), 2026, "2026-11-01");
    expect(r[0]!.action).toBe(
      "Switch Ann to the backdoor Roth — income is over the Roth IRA limit",
    );
    expect(r[0]!.context).toMatch(/Contribution Profile.*recharacterized/);
  });

  it("the backdoor in use: the pro-rata check stays, whatever the verdict", () => {
    expect(
      recs(view(150_000, 5000, true, "backdoor"), 2026, "2026-11-01").map(
        (x) => x.id,
      ),
    ).toEqual(["proRata:7"]);
    expect(
      recs(view(205_000, 5000, true, "backdoor"), 2026, "2026-11-01").map(
        (x) => x.id,
      ),
    ).toEqual(["proRata:7"]);
  });

  it("this year: now in Q4, soon before", () => {
    expect(recs(view(220_000), 2026, "2026-10-01")[0]!.urgency).toBe("now");
    expect(recs(view(220_000), 2026, "2026-09-30")[0]!.urgency).toBe("soon");
  });

  it("last year: now until the filing deadline, no pro-rata (its Dec 31 passed), nothing after", () => {
    const r = recs(view(220_000, 5000), 2026, "2027-03-01");
    expect(r.map((x) => x.id)).toEqual(["rothIra"]);
    expect(r[0]!.urgency).toBe("now");
    expect(r[0]!.context).toMatch(/2026 filing deadline/);
    expect(recs(view(220_000), 2026, "2027-04-16")).toEqual([]);
    expect(recs(view(220_000), 2025, "2027-03-01")).toEqual([]);
  });

  it("a future year: soon", () => {
    expect(recs(view(220_000), 2027, "2026-11-01")[0]!.urgency).toBe("soon");
  });
});
