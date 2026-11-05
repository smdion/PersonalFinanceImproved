import { sql } from "drizzle-orm";
import { db, isPostgres } from "@/lib/db";
import { queryRaw, tableExistsSQL } from "@/lib/db/compat";

/** Why the dashboard can't render, or null when the database answers and
 *  its core tables exist. The message is shown to the user as is. */
export async function databaseStatus(): Promise<string | null> {
  try {
    await queryRaw(db, sql`SELECT 1`);
    const rows = await queryRaw<{ has_tables: boolean | number }>(
      db,
      tableExistsSQL("people"),
    );
    // PostgreSQL returns a boolean, SQLite 1 or 0.
    const hasTable = isPostgres()
      ? rows[0]?.has_tables === true
      : rows[0]?.has_tables === 1;
    if (!hasTable) {
      return "Database tables not found. Migrations may need to run. Please restart the application.";
    }
    return null;
  } catch {
    return "Unable to connect to the database. Please check your database configuration and ensure the database server is running.";
  }
}
