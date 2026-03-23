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

    // Backfill migration journal: if DB was bootstrapped via `drizzle-kit push`,
    // migrations may exist on disk but not in __drizzle_migrations. For each
    // un-recorded migration, apply the SQL (idempotent ALTERs) and record it.
    const journal = JSON.parse(
      fs.readFileSync(path.resolve('./drizzle/meta/_journal.json'), 'utf-8'),
    );
    const client = await pool.connect();
    try {
      const { rows: recorded } = await client.query(
        'SELECT hash FROM __drizzle_migrations',
      );
      const recordedHashes = new Set(recorded.map((r: { hash: string }) => r.hash));
      const crypto = await import('crypto');
      // PG error codes for idempotent DDL (locale-independent)
      const IGNORABLE_PG_CODES = new Set([
        '42701', // duplicate_column
        '42P07', // duplicate_table
        '42710', // duplicate_object (index, constraint, etc.)
        '23505', // unique_violation
      ]);
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, 'utf-8');
        const hash = crypto.createHash('sha256').update(sql).digest('hex');
        if (recordedHashes.has(hash)) continue;
        // Try to apply each statement inside a transaction (may already exist from a prior push)
        const statements = sql
          .split('--> statement-breakpoint')
          .map((s: string) => s.trim())
          .filter(Boolean);
        await client.query('BEGIN');
        try {
          for (const stmt of statements) {
            // Use savepoints so a failed DDL doesn't abort the entire transaction
            await client.query('SAVEPOINT backfill_stmt');
            try {
              await client.query(stmt);
              await client.query('RELEASE SAVEPOINT backfill_stmt');
            } catch (stmtErr) {
              const code = (stmtErr as { code?: string }).code;
              if (code && IGNORABLE_PG_CODES.has(code)) {
                await client.query('ROLLBACK TO SAVEPOINT backfill_stmt');
              } else {
                throw stmtErr;
              }
            }
          }
          // Record in journal (within same transaction)
          await client.query(
            'INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)',
            [hash, String(Date.now())],
          );
          await client.query('COMMIT');
          log('info', 'migration_backfilled', { tag: entry.tag });
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        }
      }
    } finally {
      client.release();
    }

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
