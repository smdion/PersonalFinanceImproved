// PostgreSQL's jsonb column, read once: node-postgres already parses jsonb, and
// drizzle's column parsed a string again ("42" read back as 42). Writes are drizzle's.
import {
  entityKind,
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
} from "drizzle-orm";
import {
  PgJsonb,
  PgJsonbBuilder,
  type AnyPgTable,
  type PgJsonbBuilderInitial,
} from "drizzle-orm/pg-core";

class PgJsonbParsedOnce<
  T extends ColumnBaseConfig<"json", "PgJsonb">,
> extends PgJsonb<T> {
  static override readonly [entityKind]: string = "PgJsonbParsedOnce";

  override mapFromDriverValue(value: T["data"]): T["data"] {
    return value;
  }
}

class PgJsonbParsedOnceBuilder<
  T extends ColumnBuilderBaseConfig<"json", "PgJsonb">,
> extends PgJsonbBuilder<T> {
  static override readonly [entityKind]: string = "PgJsonbParsedOnceBuilder";

  build(table: AnyPgTable) {
    return new PgJsonbParsedOnce(table, this.config);
  }
}

export function jsonb<TName extends string>(
  name: TName,
): PgJsonbBuilderInitial<TName> {
  return new PgJsonbParsedOnceBuilder<{
    name: TName;
    dataType: "json";
    columnType: "PgJsonb";
    data: unknown;
    driverParam: unknown;
    enumValues: undefined;
  }>(name);
}
