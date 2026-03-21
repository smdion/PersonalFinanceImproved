import * as fs from 'fs';
import * as path from 'path';

function log(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...data };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function getDialect(): 'postgresql' | 'sqlite' {
  const url = process.env.DATABASE_URL;
  if (url && (url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    return 'postgresql';
  }
  return 'sqlite';
}

async function runPostgres() {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { Pool } = await import('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
    log('info', 'migrations_applied', { dialect: 'postgresql' });

    // Seed reference data if empty
    const seedClient = await pool.connect();
    try {
      const { rows } = await seedClient.query(
        'SELECT count(*)::int AS n FROM contribution_limits'
      );
      if (rows[0]?.n === 0) {
        const seedSql = fs.readFileSync(
          path.resolve('./seed-reference-data.sql'), 'utf-8'
        );
        await seedClient.query(seedSql);
        log('info', 'reference_data_seeded', { tables: 'contribution_limits, tax_brackets' });
      }
    } catch (seedErr) {
      log('warn', 'reference_data_seed_skipped', { error: (seedErr as Error).message });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
  }
}

function runSQLite() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

  const dbPath = process.env.SQLITE_PATH ?? 'data/ledgr.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './drizzle-sqlite' });
  log('info', 'migrations_applied', { dialect: 'sqlite', path: dbPath });

  // Seed reference data if empty
  try {
    const row = sqlite.prepare('SELECT count(*) AS n FROM contribution_limits').get() as { n: number };
    if (row.n === 0) {
      const seedSql = fs.readFileSync(
        path.resolve('./seed-reference-data.sql'), 'utf-8'
      );
      sqlite.exec(seedSql);
      log('info', 'reference_data_seeded', { tables: 'contribution_limits, tax_brackets' });
    }
  } catch (seedErr) {
    log('warn', 'reference_data_seed_skipped', { error: (seedErr as Error).message });
  } finally {
    sqlite.close();
  }
}

async function run() {
  const dialect = getDialect();
  log('info', 'migration_start', { dialect });

  try {
    if (dialect === 'postgresql') {
      await runPostgres();
    } else {
      runSQLite();
    }
  } catch (err) {
    log('error', 'migration_failed', {
      dialect,
      error: err instanceof Error ? err.message : String(err),
      code: (err as NodeJS.ErrnoException).code,
    });
    process.exit(1);
  }
}

run();
