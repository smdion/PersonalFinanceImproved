import { describe, it, expect } from "vitest";
import { recommendationsFromRothIra } from "@/lib/pure/recommendations-roth";
import { buildRothIraView } from "@/lib/pure/roth-ira";

// Fictional MFJ-style range.
const view = (magi: number, preTax = 0, hasEmployerPlan = true) =>
  buildRothIraView({
    rothIra: {
      filingStatus: "MFJ",
      phaseOut: { start: 200_000, end: 210_000 },
      people: [
        {
          personId: 7,
          name: "Ann",
          compensation: 180_000,
          iraLimit: 7000,
          hasEmployerPlan,
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
    expect(r[0]!.action).toMatch(/backdoor/);
    expect(r[0]!.context).toMatch(/married-separately/);
    expect(r[1]!.action).toMatch(/\$5,000.*workplace plan/);
  });

  it("no workplace plan: pro-rata is a warning, not a roll-in suggestion", () => {
    const r = recs(view(220_000, 5000, false), 2026, "2026-11-01");
    expect(r[1]!.action).not.toMatch(/workplace plan/);
    expect(r[1]!.action).toMatch(/pro-rata/);
  });

  it("too close: shows the direct amount; no pro-rata item without pre-tax IRA money", () => {
    const r = recs(view(205_000), 2026, "2026-11-01");
    expect(r).toHaveLength(1);
    expect(r[0]!.action).toMatch(/Ann \$3,500/);
  });

  it("this year: now in Q4, soon before", () => {
    expect(recs(view(220_000), 2026, "2026-10-01")[0]!.urgency).toBe("now");
    expect(recs(view(220_000), 2026, "2026-09-30")[0]!.urgency).toBe("soon");
  });

  it("last year: now until the filing deadline, no pro-rata (its Dec 31 passed), nothing after", () => {
    const r = recs(view(220_000, 5000), 2026, "2027-03-01");
    expect(r.map((x) => x.id)).toEqual(["rothIra"]);
    expect(r[0]!.urgency).toBe("now");
    expect(r[0]!.action).toMatch(/2026 filing deadline/);
    expect(recs(view(220_000), 2026, "2027-04-16")).toEqual([]);
    expect(recs(view(220_000), 2025, "2027-03-01")).toEqual([]);
  });

  it("a future year: soon", () => {
    expect(recs(view(220_000), 2027, "2026-11-01")[0]!.urgency).toBe("soon");
  });
});
