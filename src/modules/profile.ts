import * as db from './db';
import { Profile, ProfilesStore } from '../types';

export async function get(userId: string): Promise<Profile | null> {
  const result = await db.query(
    'SELECT data FROM profiles WHERE user_id = $1',
    [userId]
  );
  if (!result || result.rows.length === 0) return null;
  return result.rows[0].data as Profile;
}

export async function upsert(userId: string, updates: Partial<Profile>): Promise<Profile> {
  const existing = await get(userId);
  const now = new Date().toISOString();
  const merged: Profile = {
    ...(existing ?? { userId, createdAt: now }),
    ...updates,
    updatedAt: now,
  } as Profile;

  await db.query(
    `INSERT INTO profiles (user_id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET data = $2, updated_at = NOW()`,
    [userId, JSON.stringify(merged)]
  );
  return merged;
}

export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const p = await get(userId);
  return !!(p && p.onboardingComplete);
}

export async function getAll(): Promise<ProfilesStore> {
  const result = await db.query('SELECT data FROM profiles');
  if (!result || result.rows.length === 0) return {};
  const store: ProfilesStore = {};
  for (const row of result.rows) {
    const p = row.data as Profile;
    store[p.userId] = p;
  }
  return store;
}

export async function remove(userId: string): Promise<void> {
  await db.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
}
