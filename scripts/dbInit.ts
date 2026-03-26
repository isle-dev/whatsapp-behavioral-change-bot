import dotenv from 'dotenv';
dotenv.config();

import { getPool } from '../src/modules/db';
import { PoolClient } from 'pg';

async function init(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.error('❌ No database configuration found.');
    console.error('Set DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in .env');
    process.exit(1);
  }

  const client: PoolClient = await pool.connect();
  try {
    console.log('🔧 Initialising database schema...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS routines (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        times       TEXT[]  NOT NULL DEFAULT '{}',
        days        TEXT[]  DEFAULT NULL,
        quiet_start TEXT    DEFAULT NULL,
        quiet_end   TEXT    DEFAULT NULL,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ routines table ready');

    await client.query(`
      CREATE INDEX IF NOT EXISTS routines_user_id_idx ON routines (user_id)
    `);
    console.log('✅ routines index ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS onboarding_responses (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT        NOT NULL,
        step        TEXT        NOT NULL,
        raw_input   TEXT        NOT NULL,
        parsed_value TEXT       DEFAULT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ onboarding_responses table ready');

    await client.query(`
      CREATE INDEX IF NOT EXISTS onboarding_responses_user_id_idx
        ON onboarding_responses (user_id)
    `);
    console.log('✅ onboarding_responses index ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS trait_profiles (
        user_id               TEXT PRIMARY KEY,
        med_timing            TEXT        DEFAULT NULL,
        checkin_frequency     TEXT        DEFAULT NULL,
        med_anchor            TEXT        DEFAULT NULL,
        storage_location      TEXT        DEFAULT NULL,
        memory_aids           TEXT        DEFAULT NULL,
        weekend_routine_diff  TEXT        DEFAULT NULL,
        schedule_type         TEXT        DEFAULT NULL,
        yesterday_adherence   BOOLEAN     DEFAULT NULL,
        social_support        TEXT        DEFAULT NULL,
        necessity_belief      TEXT        DEFAULT NULL,
        concerns_belief       TEXT        DEFAULT NULL,
        illness_understanding TEXT        DEFAULT NULL,
        weekday_routine       TEXT        DEFAULT NULL,
        yesterday_barrier     TEXT        DEFAULT NULL,
        general_barriers      TEXT        DEFAULT NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ trait_profiles table ready');

    console.log('\n🎉 Database initialisation complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch((err: Error) => {
  console.error('❌ DB init failed:', err.message);
  process.exit(1);
});
