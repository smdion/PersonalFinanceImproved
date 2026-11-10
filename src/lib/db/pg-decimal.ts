// PostgreSQL's numeric column, read as decimal text in the one form both
// databases return (canonicalDecimalText): "300.00" reads as "300".
import {
  entityKind,
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
} from "drizzle-orm";
import {
  PgNumeric,
  PgNumericBuilder,
  type AnyPgTable,
  type PgNumericBuilderInitial,
} from "drizzle-orm/pg-core";
import { canonicalDecimalText } from "@/lib/utils/decimal-text";

class PgDecimalText<
  T extends ColumnBaseConfig<"string", "PgNumeric">,
> extends PgNumeric<T> {
  static override readonly [entityKind]: string = "PgDecimalText";

  override mapFromDriverValue(value: unknown): string {
    return canonicalDecimalText(super.mapFromDriverValue(value));
  }
}

class PgDecimalTextBuilder<
  T extends ColumnBuilderBaseConfig<"string", "PgNumeric">,
> extends PgNumericBuilder<T> {
  static override readonly [entityKind]: string = "PgDecimalTextBuilder";

  build(table: AnyPgTable) {
    return new PgDecimalText(table, this.config);
  }
}

export function decimal<TName extends string>(
  name: TName,
  config: { precision: number; scale: number },
): PgNumericBuilderInitial<TName> {
  return new PgDecimalTextBuilder<{
    name: TName;
    dataType: "string";
    columnType: "PgNumeric";
    data: string;
    driverParam: string;
    enumValues: undefined;
  }>(name, config.precision, config.scale);
}
