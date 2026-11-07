/* eslint-disable no-restricted-syntax -- as unknown as casts hand the view model a tooltip renderer that returns its data */
/**
 * The projection table rows' view models (plan commit 20): each function
 * takes the row's values and formats them with the page's formatters. The
 * years come from a real engine run of an invented household; the tooltip
 * renderer hands back the data it was given, so each line can be read.
 * `deflate` halves every amount, so a figure that skips it shows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
  ProjectionResult,
} from "@/lib/pure/engine/types";
import { formatCurrency } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { ProjectionState } from "@/components/retirement-projection/projection-table-types";
import type { TooltipData } from "@/components/retirement-projection/types";
import {
  contributionTaxTypeTotals,
  displaySalary,
  gapDrawnItems,
  yearAgesTooltip,
} from "@/components/retirement-projection/projection-table-accum-row.model";
import { totalContributionTooltip } from "@/components/retirement-projection/projection-table-accum-balances.model";
import {
  categoryCellColor,
  categoryCellText,
  taxTypeCellText,
  totalWithdrawalText,
} from "@/components/retirement-projection/projection-table-decum-row.model";
import { totalWithdrawalTooltip } from "@/components/retirement-projection/projection-table-decum-balances.model";
import { annAndBo, people } from "../projection-household";

const deflate: ProjectionState["deflate"] = (v) => v / 2;
const renderTooltip = ((data: TooltipData) =>
  data) as unknown as ProjectionState["renderTooltip"];
/** What a model handed the renderer. */
const dataOf = (node: unknown) => node as TooltipData;

let projection: ProjectionResult;
const accum = (year: number) =>
  projection.projectionByYear.find(
    (y) => y.year === year && y.phase === "accumulation",
  ) as EngineAccumulationYear;
const decum = (year: number) =>
  projection.projectionByYear.find(
    (y) => y.year === year && y.phase === "decumulation",
  ) as EngineDecumulationYear;

beforeAll(() => {
  projection = calculateProjection(annAndBo());
});

describe("accumulation row view model", () => {
  it("yearAgesTooltip names each person's age that year", () => {
    const data = dataOf(
      yearAgesTooltip(people, undefined, renderTooltip, accum(2027)),
    );
    expect(data).toMatchObject({ kind: "info" });
    const texts = (data as { lines: { text: string }[] }).lines.map(
      (l) => l.text,
    );
    expect(texts).toContain("Ann: 51");
  });

  it("yearAgesTooltip shows nothing with no people", () => {
    expect(
      yearAgesTooltip([], undefined, renderTooltip, accum(2027)),
    ).toBeUndefined();
  });

  it("displaySalary is the household salary, deflated and formatted", () => {
    const yr = accum(2027);
    expect(displaySalary(yr, false, undefined, "all", deflate)).toBe(
      formatCurrency(yr.projectedSalary / 2),
    );
  });

  it("contributionTaxTypeTotals lists the household's buckets, deflated", () => {
    const yr = { ...accum(2027), totalTraditional: 1000, totalRoth: 400 };
    const lines = contributionTaxTypeTotals(yr, null, [], deflate);
    expect(lines.slice(0, 2)).toEqual([
      { label: taxTypeLabel("preTax"), amount: 500, color: "blue" },
      { label: taxTypeLabel("taxFree"), amount: 200, color: "violet" },
    ]);
  });

  it("contributionTaxTypeTotals lists a filtered person's accounts by tax type", () => {
    const yr = accum(2027);
    const mine = (yr.individualAccountBalances ?? []).map((ia) => ({
      ...ia,
      contribution: 100,
    }));
    const pt = {} as ReturnType<ProjectionState["getPersonYearTotals"]>;
    const lines = contributionTaxTypeTotals(yr, pt, mine, deflate);
    expect(lines.map((l) => [l.amount, l.color])).toEqual([
      [50, "blue"],
      [50, "violet"],
      [50, "amber"],
    ]);
  });

  it("gapDrawnItems lists each account drawn in a gap year, signed and deflated", () => {
    const yr = accum(2030);
    const shown = yr.individualAccountBalances ?? [];
    const items = gapDrawnItems(yr, shown, deflate);
    const drawn = shown.filter((ia) => (ia.draw?.withdrawal ?? 0) > 0);
    expect(items).toHaveLength(drawn.length);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.prefix).toBe("-");
      expect(item.color).toBe("red");
    }
    const sum = items.reduce((s, i) => s + i.amount, 0);
    const want = drawn.reduce((s, ia) => s + ia.draw!.withdrawal, 0) / 2;
    expect(sum).toBeCloseTo(want, 6);
  });

  it("totalContributionTooltip shows a gap year's withdrawal, deflated", () => {
    const yr = accum(2030);
    const drawnTotal = (
      r: NonNullable<EngineAccumulationYear["individualAccountBalances"]>,
    ) => r.reduce((t, ia) => t + (ia.draw?.withdrawal ?? 0), 0);
    const data = dataOf(
      totalContributionTooltip(
        yr,
        null,
        "all",
        undefined,
        undefined,
        deflate,
        undefined,
        undefined,
        undefined,
        drawnTotal,
        (r) => r,
        renderTooltip,
        false,
        "",
        undefined,
        [],
        undefined,
      ),
    ) as { withdrawals?: { amount: number } };
    expect(yr.gapDraw!.withdrawal).toBeGreaterThan(0);
    expect(data.withdrawals?.amount).toBeCloseTo(yr.gapDraw!.withdrawal / 2, 6);
  });
});

describe("decumulation row view model", () => {
  it("categoryCellText shows a draw with a minus sign, deflated", () => {
    const yr = decum(2033);
    const slot = yr.slots.find((s) => s.withdrawal > 0)!;
    expect(
      categoryCellText([], slot.category, slot.withdrawal, deflate, yr),
    ).toBe(`-${formatCurrency(slot.withdrawal / 2)}`);
    expect(categoryCellText([], slot.category, 0, deflate, yr)).toBe("---");
  });

  it("categoryCellColor is the category's color when no lump sum lands", () => {
    const yr = decum(2033);
    const slot = yr.slots.find((s) => s.withdrawal > 0)!;
    expect(categoryCellColor([], slot.category, slot.withdrawal)).not.toBe(
      "text-green-600",
    );
  });

  it("taxTypeCellText nets lump sums against the draw", () => {
    const yr = decum(2033);
    const lump = [
      { amount: 1000, targetAccount: "brokerage", label: "Gift" },
    ] as unknown as EngineDecumulationYear["config"]["lumpSums"];
    expect(taxTypeCellText(lump, "afterTax", 400, deflate, yr)).toBe(
      `+${formatCurrency(300)}`,
    );
    expect(taxTypeCellText(lump, "afterTax", 1400, deflate, yr)).toBe(
      `-${formatCurrency(200)}`,
    );
  });

  it("totalWithdrawalText shows the year's draw, and depleted when the money is gone", () => {
    const yr = decum(2033);
    expect(totalWithdrawalText(deflate, 0, yr, yr)).toBe(
      `-${formatCurrency(yr.totalWithdrawal / 2)}`,
    );
    const empty = {
      ...yr,
      totalWithdrawal: 0,
      retirementBalance: 0,
      projectedExpenses: 1,
    };
    expect(totalWithdrawalText(deflate, 0, empty, empty)).toBe("depleted");
  });

  it("totalWithdrawalTooltip keeps the penalty-locked shortfall, deflated", () => {
    const yr = decum(2035);
    const data = dataOf(
      totalWithdrawalTooltip(
        yr,
        null,
        "all",
        yr,
        new Map(yr.slots.map((s) => [s.category, s])),
        yr.config.lumpSums,
        deflate,
        () => ({}),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        renderTooltip,
        false,
        undefined,
        undefined,
      ),
    ) as { shortfall?: { penaltyAvoidedAmount?: number } };
    expect(yr.penaltyAvoidedShortfall).toBeGreaterThan(0);
    expect(data.shortfall?.penaltyAvoidedAmount).toBeCloseTo(
      yr.penaltyAvoidedShortfall! / 2,
      6,
    );
  });
});
