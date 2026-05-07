// Adherence monitoring module — stores and queries Y/N dose events.
// Primary storage is Postgres (adherence_events table); JSON is the fallback.
import fs from 'fs';
import path from 'path';
import * as db from './db';

const DATA_DIR     = path.join(__dirname, '../../data');
const ADHERENCE_PATH = path.join(DATA_DIR, 'adherence.json');

export interface AdherenceEvent {
  userId: string;
  timestamp: string;       // ISO 8601
  taken: boolean;
  barrier?: string;
  com_b_barrier?: 'Capability' | 'Opportunity' | 'Motivation';
  source: 'self_report' | 'reminder_response' | 'manual';
}

export interface AdherenceStore {
  [userId: string]: AdherenceEvent[];
}

export interface AdherenceSummary {
  userId: string;
  totalDoses: number;
  takenDoses: number;
  missedDoses: number;
  adherenceRate: number;
  currentStreak: number;
  longestStreak: number;
  lastEvent?: AdherenceEvent;
  recentBarriers: string[];
}

// ─── JSON helpers (fallback) ──────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAllJson(): AdherenceStore {
  ensureDataDir();
  if (!fs.existsSync(ADHERENCE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ADHERENCE_PATH, 'utf8')) as AdherenceStore;
  } catch (_) {
    return {};
  }
}

function writeAllJson(store: AdherenceStore): void {
  ensureDataDir();
  fs.writeFileSync(ADHERENCE_PATH, JSON.stringify(store, null, 2));
}

// ─── Row → AdherenceEvent adapter ────────────────────────────────────────────

function rowToEvent(row: Record<string, unknown>): AdherenceEvent {
  return {
    userId:       row.user_id as string,
    timestamp:    row.recorded_at instanceof Date
      ? (row.recorded_at as Date).toISOString()
      : String(row.recorded_at),
    taken:        row.taken as boolean,
    barrier:      row.barrier as string | undefined ?? undefined,
    com_b_barrier: row.com_b_barrier as AdherenceEvent['com_b_barrier'] ?? undefined,
    source:       (row.source as AdherenceEvent['source']) ?? 'self_report',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function clearUser(userId: string): Promise<void> {
  try {
    await db.query('DELETE FROM adherence_events WHERE user_id = $1', [userId]);
  } catch (_) { /* DB unavailable */ }
  const store = readAllJson();
  delete store[userId];
  writeAllJson(store);
}

export async function logDose(
  userId: string,
  taken: boolean,
  opts: {
    barrier?: string;
    com_b_barrier?: AdherenceEvent['com_b_barrier'];
    source?: AdherenceEvent['source'];
  } = {}
): Promise<AdherenceEvent> {
  const event: AdherenceEvent = {
    userId,
    timestamp: new Date().toISOString(),
    taken,
    source: opts.source ?? 'self_report',
  };
  if (opts.barrier)      event.barrier      = opts.barrier;
  if (opts.com_b_barrier) event.com_b_barrier = opts.com_b_barrier;

  // Write to Postgres (best-effort)
  try {
    await db.query(
      `INSERT INTO adherence_events (user_id, taken, barrier, com_b_barrier, source, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, taken, opts.barrier ?? null, opts.com_b_barrier ?? null, event.source, event.timestamp]
    );
  } catch (_) { /* DB unavailable — JSON fallback below */ }

  // Always write to JSON as backup
  const store = readAllJson();
  if (!store[userId]) store[userId] = [];
  store[userId].push(event);
  writeAllJson(store);
  return event;
}

export async function amendLastBarrier(userId: string, barrier: string): Promise<void> {
  const com_b = classifyBarrier(barrier);

  // Update in Postgres (best-effort)
  try {
    await db.query(
      `UPDATE adherence_events
       SET barrier = $1, com_b_barrier = $2
       WHERE id = (
         SELECT id FROM adherence_events
         WHERE user_id = $3 AND taken = false AND barrier IS NULL
         ORDER BY recorded_at DESC LIMIT 1
       )`,
      [barrier, com_b, userId]
    );
  } catch (_) { /* DB unavailable */ }

  // Update JSON
  const store = readAllJson();
  const events = store[userId];
  if (events) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (!events[i].taken && !events[i].barrier) {
        events[i].barrier      = barrier;
        events[i].com_b_barrier = com_b;
        break;
      }
    }
    writeAllJson(store);
  }
}

export async function getHistory(userId: string, days?: number): Promise<AdherenceEvent[]> {
  // Try Postgres first
  try {
    const params: unknown[] = [userId];
    let sql = 'SELECT * FROM adherence_events WHERE user_id = $1';
    if (days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      sql += ' AND recorded_at >= $2';
      params.push(cutoff.toISOString());
    }
    sql += ' ORDER BY recorded_at ASC';
    const result = await db.query(sql, params);
    // If Postgres has rows for this user, use them
    if (result && result.rows.length > 0) {
      return result.rows.map(rowToEvent);
    }
  } catch (_) { /* DB unavailable */ }

  // JSON fallback
  const events = readAllJson()[userId] ?? [];
  if (!days) return events;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return events.filter((e) => new Date(e.timestamp) >= cutoff);
}

export async function getSummary(userId: string, days = 30): Promise<AdherenceSummary> {
  const events = await getHistory(userId, days);
  const taken  = events.filter((e) => e.taken);
  const missed = events.filter((e) => !e.taken);

  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  let currentStreak = 0;
  for (const e of sorted) {
    if (e.taken) currentStreak++;
    else break;
  }

  let longestStreak = 0;
  let runningStreak = 0;
  for (const e of [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )) {
    if (e.taken) { runningStreak++; longestStreak = Math.max(longestStreak, runningStreak); }
    else runningStreak = 0;
  }

  return {
    userId,
    totalDoses: events.length,
    takenDoses: taken.length,
    missedDoses: missed.length,
    adherenceRate: events.length ? taken.length / events.length : 0,
    currentStreak,
    longestStreak,
    lastEvent: sorted[0],
    recentBarriers: missed.filter((e) => e.barrier).slice(-5).map((e) => e.barrier as string),
  };
}

export async function getTrendMessage(userId: string, tone = 'encouraging'): Promise<string> {
  const summary = await getSummary(userId, 7);

  if (summary.totalDoses === 0) {
    return tone === 'empathetic'
      ? "We haven't tracked any doses yet — that's okay. Reply Y or N after each dose."
      : "No doses logged yet. Reply Y after you take your medication today!";
  }

  const rate   = summary.adherenceRate;
  const streak = summary.currentStreak;

  if (rate >= 0.9) {
    if (tone === 'encouraging') return `🌟 You're on a ${streak}-day streak! Fantastic consistency.`;
    if (tone === 'empathetic')  return `You've been so consistent — ${streak} days in a row. That takes real effort. 💙`;
    return `${streak}-day streak. Keep going.`;
  }
  if (rate >= 0.7) {
    if (tone === 'encouraging') return `You're doing well — ${Math.round(rate * 100)}% this week. One day at a time!`;
    if (tone === 'empathetic')  return `${Math.round(rate * 100)}% this week — some days are harder than others. You're still showing up. 💙`;
    return `${Math.round(rate * 100)}% adherence this week.`;
  }
  if (tone === 'encouraging') return `This week was tough, but every dose counts. Let's try again today!`;
  if (tone === 'empathetic')  return `Some weeks are harder. What got in the way? I'm here to help. 💙`;
  return `Adherence was ${Math.round(rate * 100)}% this week. Check in when you can.`;
}

export function classifyBarrier(barrier: string): AdherenceEvent['com_b_barrier'] {
  const b = barrier.toLowerCase();
  if (/forgot|forget|memory|confus|side effect|pain|dizz|nausea|tired|fatig|physical|health/.test(b)) return 'Capability';
  if (/ran out|pharmacy|refill|no pill|work|busy|travel|away|no time|wasn.t home|wasn.t there/.test(b)) return 'Opportunity';
  if (/didn.t think|didn.t feel|feel fine|feel good|no reason|don.t want|not sure why|motivation|remiss/.test(b)) return 'Motivation';
  return 'Motivation';
}
