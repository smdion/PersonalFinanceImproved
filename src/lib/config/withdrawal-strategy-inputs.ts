/**
 * The API input for each withdrawal-strategy param column, derived from the
 * strategy config's param fields.
 */
import { z } from "zod/v4";
import { zDecimal } from "@/lib/utils/zod-fields";
import {
  strategyParamFields,
  type StrategyParamColumn,
  type StrategyParamField,
} from "./withdrawal-strategies";

type ParamBaseSchema<F> = F extends { type: "boolean" }
  ? z.ZodBoolean
  : F extends { integer: true }
    ? z.ZodNumber
    : typeof zDecimal;
type ParamColumnSchema<F> = z.ZodOptional<
  F extends { nullable: true }
    ? z.ZodNullable<ParamBaseSchema<F>>
    : ParamBaseSchema<F>
>;

/** Each strategy param column's input, from its config field: a boolean, a
 *  whole number within the field's bounds, or a decimal string; nullable
 *  where the column's null means the default. */
export function strategyParamInputShape(): {
  [C in StrategyParamColumn]: ParamColumnSchema<
    Extract<StrategyParamField, { column: C }>
  >;
} {
  const columnSchema = (f: StrategyParamField): z.ZodType => {
    const base: z.ZodType =
      f.type === "boolean"
        ? z.boolean()
        : "integer" in f
          ? z.number().int().min(f.min).max(f.max)
          : zDecimal;
    return ("nullable" in f ? base.nullable() : base).optional();
  };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- each column's schema is built from the field the type maps
  return Object.fromEntries(
    strategyParamFields().map((f) => [f.column, columnSchema(f)]),
  ) as ReturnType<typeof strategyParamInputShape>;
}
