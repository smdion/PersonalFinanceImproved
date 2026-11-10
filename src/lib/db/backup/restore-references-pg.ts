/** A PostgreSQL restore runs with triggers off (`session_replication_role = 'replica'`), so
 *  no foreign key is checked while it inserts: before it commits, triggers go back on and
 *  every reference is checked, and a broken one refuses the restore, naming keys only. */

type Client = {
  query: (text: string) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Every foreign key of the current schema, as quoted column lists. */
const FOREIGN_KEYS = `SELECT con.conname AS name,
    con.conrelid::regclass::text AS child,
    con.confrelid::regclass::text AS parent,
    ARRAY(SELECT quote_ident(a.attname) FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
    ARRAY(SELECT quote_ident(a.attname) FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.i) AS parent_columns
  FROM pg_constraint con JOIN pg_namespace ns ON ns.oid = con.connamespace
  WHERE con.contype = 'f' AND ns.nspname = current_schema()
  ORDER BY con.conname`;

/** A text[] column as node-pg returns it. */
const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

/** Triggers back on, then every foreign key checked as PostgreSQL would (a row with a null
 *  key column is not checked); throws naming the broken keys, never a value. */
export async function assertReferencesHold(client: Client): Promise<void> {
  await client.query("SET session_replication_role = 'origin'");
  const broken: string[] = [];
  for (const key of (await client.query(FOREIGN_KEYS)).rows) {
    const columns = names(key["columns"]);
    const parentColumns = names(key["parent_columns"]);
    const present = columns.map((c) => `c.${c} IS NOT NULL`).join(" AND ");
    const matches = columns
      .map((c, i) => `p.${parentColumns[i]} = c.${c}`)
      .join(" AND ");
    const { rows } = await client.query(
      `SELECT 1 FROM ${String(key["child"])} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${String(key["parent"])} p WHERE ${matches}) LIMIT 1`,
    );
    if (rows.length > 0)
      broken.push(
        `${String(key["child"])} → ${String(key["parent"])} (${String(key["name"])})`,
      );
  }
  if (broken.length > 0)
    throw new Error(
      `This backup's rows point at rows it doesn't have: ${broken.join(", ")}. Nothing was restored.`,
    );
}
