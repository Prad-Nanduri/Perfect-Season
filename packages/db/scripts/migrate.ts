import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _dev_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  // The tracking table is in `public` like everything else; RLS keeps anon key
  // holders out while the table owner (the migrate role) is unaffected.
  await pool.query('ALTER TABLE _dev_migrations ENABLE ROW LEVEL SECURITY');

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of migrationNames) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ name: string }>(
        'SELECT name FROM _dev_migrations WHERE name = $1',
        [name],
      );
      if (result.rowCount === 0) {
        const sql = await readFile(`${migrationsDirectory}/${name}`, 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO _dev_migrations (name) VALUES ($1)', [name]);
        console.log(`Applied ${name}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

const invokedFile = process.argv[1]?.replaceAll('\\', '/') ?? '';
if (invokedFile.endsWith('/migrate.ts')) {
  await main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
