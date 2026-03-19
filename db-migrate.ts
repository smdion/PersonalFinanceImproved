import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

function log(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...data };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const pool = new Pool({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? '',
  database: process.env.DATABASE_NAME ?? 'ledgr',
  ssl: false,
});

async function run() {
  const client = await pool.connect();

  try {
    // Check if this is an existing DB that predates the squashed migration.
    // If tables already exist but the drizzle journal only has the squashed
    // 0000_initial_schema entry, we need to mark it as already applied so
    // drizzle doesn't try to CREATE TABLE on an existing schema.
    const journalPath = path.resolve('./drizzle/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const entries: { tag: string }[] = journal.entries ?? [];

    if (entries.length === 1 && entries[0]?.tag === '0000_initial_schema') {
      // Check if the DB already has tables (i.e. pre-squash production DB)
      const { rows } = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'people'
        ) AS has_tables`
      );

      if (rows[0]?.has_tables) {
        // Ensure the drizzle migrations tracking table exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          )
        `);

        // Check if the squashed migration is already recorded
        const migrationSql = fs.readFileSync(
          path.resolve('./drizzle/0000_initial_schema.sql'),
          'utf-8',
        );
        const hash = crypto.createHash('sha256').update(migrationSql).digest('hex');

        const { rows: existing } = await client.query(
          `SELECT 1 FROM "__drizzle_migrations" WHERE hash = $1`,
          [hash],
        );

        if (existing.length === 0) {
          // Clear old migration records and insert the squashed one
          await client.query(`DELETE FROM "__drizzle_migrations"`);
          await client.query(
            `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
            [hash, Date.now()],
          );
          log('info', 'squash_migration_marked', { message: 'Existing DB detected — marked squashed migration as applied' });
        }
      }
    }

  } finally {
    client.release();
  }

  // Now run drizzle migrate normally — it will skip already-applied migrations
  // and apply any new ones added after the squash
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
    log('info', 'migrations_applied', { message: 'Migrations applied successfully' });

    // Seed reference data (contribution_limits, tax_brackets) if empty.
    // These tables are required by paycheck/contribution/retirement calculators
    // but aren't populated by migrations — only by manual setup or backup import.
    const seedClient = await pool.connect();
    try {
      const { rows: limitsCount } = await seedClient.query(
        'SELECT count(*)::int AS n FROM contribution_limits'
      );
      if (limitsCount[0]?.n === 0) {
        const seedSql = fs.readFileSync(
          path.resolve('./seed-reference-data.sql'),
          'utf-8'
        );
        await seedClient.query(seedSql);
        log('info', 'reference_data_seeded', { tables: 'contribution_limits, tax_brackets' });
      }
    } catch (seedErr) {
      log('warn', 'reference_data_seed_skipped', { error: (seedErr as Error).message });
    } finally {
      seedClient.release();
    }
  } catch (err) {
    log('error', 'migration_failed', {
      error: err instanceof Error ? err.message : String(err),
      code: (err as NodeJS.ErrnoException).code,
      host: process.env.DATABASE_HOST ?? 'localhost',
      database: process.env.DATABASE_NAME ?? 'ledgr',
    });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
