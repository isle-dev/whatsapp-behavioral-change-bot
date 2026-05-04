// Patient profile store — reads/writes data/profiles.json.
// Onboarding state is persisted here; routine scheduling metadata goes to Postgres.
import fs from 'fs';
import path from 'path';
import { Profile, ProfilesStore } from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): ProfilesStore {
  ensureDataDir();
  if (!fs.existsSync(PROFILES_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')) as ProfilesStore;
  } catch (_) {
    return {};
  }
}

function writeAll(profiles: ProfilesStore): void {
  ensureDataDir();
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

function get(userId: string): Profile | null {
  return readAll()[userId] || null;
}

function upsert(userId: string, updates: Partial<Profile>): Profile {
  const all = readAll();
  const existing = all[userId] || { userId, createdAt: new Date().toISOString() };
  all[userId] = { ...existing, ...updates, updatedAt: new Date().toISOString() } as Profile;
  writeAll(all);
  return all[userId];
}

function isOnboardingComplete(userId: string): boolean {
  const p = get(userId);
  return !!(p && p.onboardingComplete);
}

function remove(userId: string): void {
  const all = readAll();
  delete all[userId];
  writeAll(all);
}

export { get, upsert, isOnboardingComplete, remove };
