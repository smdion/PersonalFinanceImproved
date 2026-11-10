// SQLite's text column for a PostgreSQL numeric (gen-sqlite-schema.ts),
// read as decimal text in the one form both databases return
// (canonicalDecimalText): "300.00" written reads as "300".
import {
  entityKind,
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
} from "drizzle-orm";
import {
  SQLiteText,
  SQLiteTextBuilder,
  type AnySQLiteTable,
  type SQLiteTextBuilderInitial,
} from "drizzle-orm/sqlite-core";
import { canonicalDecimalText } from "@/lib/utils/decimal-text";

class SQLiteDecimalText<
  T extends ColumnBaseConfig<"string", "SQLiteText">,
> extends SQLiteText<T> {
  static override readonly [entityKind]: string = "SQLiteDecimalText";

  override mapFromDriverValue(value: unknown): string {
    return canonicalDecimalText(String(value));
  }
}

class SQLiteDecimalTextBuilder<
  T extends ColumnBuilderBaseConfig<"string", "SQLiteText">,
> extends SQLiteTextBuilder<T> {
  static override readonly [entityKind]: string = "SQLiteDecimalTextBuilder";

  build(table: AnySQLiteTable) {
    return new SQLiteDecimalText(table, this.config);
  }
}

export function decimalText<TName extends string>(
  name: TName,
): SQLiteTextBuilderInitial<TName, [string, ...string[]], undefined> {
  return new SQLiteDecimalTextBuilder<{
    name: TName;
    dataType: "string";
    columnType: "SQLiteText";
    data: string;
    driverParam: string;
    enumValues: [string, ...string[]];
    length: undefined;
  }>(name, {});
}
