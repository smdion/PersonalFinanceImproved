/**
 * The strategy param columns' API input is derived from the config's param
 * fields. HAND_WRITTEN spells out each column's expected schema; the derived
 * one must accept and reject exactly the same values for every column.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { zDecimal } from "@/lib/utils/zod-fields";
import { strategyParamInputShape } from "@/lib/config/withdrawal-strategy-inputs";

const HAND_WRITTEN = {
  gkUpperGuardrail: zDecimal.optional(),
  gkLowerGuardrail: zDecimal.optional(),
  gkIncreasePct: zDecimal.optional(),
  gkDecreasePct: zDecimal.optional(),
  gkSkipInflationAfterLoss: z.boolean().optional(),
  sdAnnualDeclineRate: zDecimal.optional(),
  cpWithdrawalPercent: zDecimal.optional(),
  cpFloorPercent: zDecimal.optional(),
  enWithdrawalPercent: zDecimal.optional(),
  enRollingYears: z.number().int().min(3).max(20).optional(),
  enFloorPercent: zDecimal.optional(),
  vdBasePercent: zDecimal.optional(),
  vdCeilingPercent: zDecimal.optional(),
  vdFloorPercent: zDecimal.optional(),
  rmdMultiplier: zDecimal.optional(),
  vpwCap: zDecimal.nullable().optional(),
  vpwEndAge: z.number().int().min(90).max(110).nullable().optional(),
  cpSsInAmount: z.boolean().nullable().optional(),
  enSsInAmount: z.boolean().nullable().optional(),
  vdSsInAmount: z.boolean().nullable().optional(),
  rmdSsInAmount: z.boolean().nullable().optional(),
  vpwSsInAmount: z.boolean().nullable().optional(),
};

const SAMPLES: unknown[] = [
  undefined,
  null,
  true,
  false,
  "0.05",
  "",
  " ",
  "abc",
  "1e2",
  0,
  2,
  3,
  10,
  20,
  21,
  89,
  90,
  100,
  110,
  111,
  10.5,
  -1,
  "10",
];

describe("strategyParamInputShape", () => {
  const derived: Record<string, z.ZodType> = strategyParamInputShape();

  it("has exactly the hand-written columns", () => {
    expect(Object.keys(derived).sort()).toEqual(
      Object.keys(HAND_WRITTEN).sort(),
    );
  });

  it.each(Object.entries(HAND_WRITTEN))(
    "%s accepts and rejects the same values",
    (column, hand) => {
      const schema = derived[column]!;
      for (const v of SAMPLES) {
        expect(schema.safeParse(v).success, `${column} ← ${String(v)}`).toBe(
          hand.safeParse(v).success,
        );
      }
    },
  );
});
