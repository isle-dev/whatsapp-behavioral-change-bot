// Postgres connection pool with graceful no-op fallback when DB is not configured.
import { Pool, QueryResult } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString && !process.env.DB_HOST) return null;

  pool = new Pool(
    connectionString
      ? { connectionString }
      : {
          host: process.env.DB_HOST,
          port: parseInt(process.env.DB_PORT || '5432', 10),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
        }
  );

  pool.on('error', (err: Error) => console.error('DB pool error:', err.message));
  return pool;
}

async function query(sql: string, params: unknown[] = []): Promise<QueryResult | null> {
  const p = getPool();
  if (!p) return null;
  try {
    return await p.query(sql, params as unknown[]);
  } catch (err) {
    console.error('DB query error:', (err as Error).message);
    return null;
  }
}

export { getPool, query };
