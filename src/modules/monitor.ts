// Adherence monitoring module — stores and queries Y/N dose events.
// Events are written to data/adherence.json (no raw message content).
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const ADHERENCE_PATH = path.join(DATA_DIR, 'adherence.json');

export interface AdherenceEvent {
  userId: string;
  timestamp: string;       // ISO 8601
  taken: boolean;          // true = dose taken, false = missed
  barrier?: string;        // optional free-text barrier (if missed)
  com_b_barrier?: 'Capability' | 'Opportunity' | 'Motivation'; // classified barrier
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
  adherenceRate: number;   // 0–1
  currentStreak: number;   // consecutive taken days
  longestStreak: number;
  lastEvent?: AdherenceEvent;
  recentBarriers: string[];
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): AdherenceStore {
  ensureDataDir();
  if (!fs.existsSync(ADHERENCE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ADHERENCE_PATH, 'utf8')) as AdherenceStore;
  } catch (_) {
    return {};
  }
}

function writeAll(store: AdherenceStore): void {
  ensureDataDir();
  fs.writeFileSync(ADHERENCE_PATH, JSON.stringify(store, null, 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a dose event for a user.
 */
export function clearUser(userId: string): void {
  const store = readAll();
  delete store[userId];
  writeAll(store);
}

export function logDose(
  userId: string,
  taken: boolean,
  opts: {
    barrier?: string;
    com_b_barrier?: AdherenceEvent['com_b_barrier'];
    source?: AdherenceEvent['source'];
  } = {}
): AdherenceEvent {
  const store = readAll();
  if (!store[userId]) store[userId] = [];

  const event: AdherenceEvent = {
    userId,
    timestamp: new Date().toISOString(),
    taken,
    source: opts.source ?? 'self_report',
  };
  if (opts.barrier) event.barrier = opts.barrier;
  if (opts.com_b_barrier) event.com_b_barrier = opts.com_b_barrier;

  store[userId].push(event);
  writeAll(store);
  return event;
}

/**
 * Get all events for a user, optionally limited to the last N days.
 */
export function getHistory(userId: string, days?: number): AdherenceEvent[] {
  const store = readAll();
  const events = store[userId] ?? [];
  if (!days) return events;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return events.filter((e) => new Date(e.timestamp) >= cutoff);
}

/**
 * Compute an adherence summary for a user over the last N days (default: 30).
 */
export function getSummary(userId: string, days = 30): AdherenceSummary {
  const events = getHistory(userId, days);
  const taken = events.filter((e) => e.taken);
  const missed = events.filter((e) => !e.taken);

  // Current streak: count consecutive taken events from the most recent backward
  let currentStreak = 0;
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  for (const e of sorted) {
    if (e.taken) currentStreak++;
    else break;
  }

  // Longest streak across all events
  let longestStreak = 0;
  let runningStreak = 0;
  for (const e of events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )) {
    if (e.taken) {
      runningStreak++;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const recentBarriers = missed
    .filter((e) => e.barrier)
    .slice(-5)
    .map((e) => e.barrier as string);

  return {
    userId,
    totalDoses: events.length,
    takenDoses: taken.length,
    missedDoses: missed.length,
    adherenceRate: events.length ? taken.length / events.length : 0,
    currentStreak,
    longestStreak,
    lastEvent: sorted[0],
    recentBarriers,
  };
}

/**
 * Get a human-readable feedback message based on adherence trends.
 * Used by the decision engine to personalise reminder copy.
 */
export function getTrendMessage(userId: string, tone: string = 'encouraging'): string {
  const summary = getSummary(userId, 7);

  if (summary.totalDoses === 0) {
    return tone === 'empathetic'
      ? "We haven't tracked any doses yet — that's okay. Reply Y or N after each dose."
      : "No doses logged yet. Reply Y after you take your medication today!";
  }

  const rate = summary.adherenceRate;
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

  // Below 70%
  if (tone === 'encouraging') return `This week was tough, but every dose counts. Let's try again today!`;
  if (tone === 'empathetic')  return `Some weeks are harder. What got in the way? I'm here to help. 💙`;
  return `Adherence was ${Math.round(rate * 100)}% this week. Check in when you can.`;
}

/**
 * Classify a free-text missed-dose barrier into a COM-B sub-category.
 * Lightweight rule-based classifier — use this for offline/demo mode;
 * the LLM-powered version is in evalClassification.ts for full accuracy.
 */
export function classifyBarrier(barrier: string): AdherenceEvent['com_b_barrier'] {
  const b = barrier.toLowerCase();

  // Capability barriers: forgetting, confusion, side effects, physical issues
  if (/forgot|forget|memory|confus|side effect|pain|dizz|nausea|tired|fatig|physical|health/.test(b)) {
    return 'Capability';
  }
  // Opportunity barriers: no access, ran out, pharmacy, work, travelling, no time
  if (/ran out|pharmacy|refill|no pill|work|busy|travel|away|no time|wasn.t home|wasn.t there/.test(b)) {
    return 'Opportunity';
  }
  // Motivation barriers: didn't think it mattered, didn't feel sick, didn't want to
  if (/didn.t think|didn.t feel|feel fine|feel good|no reason|don.t want|not sure why|motivation|remiss/.test(b)) {
    return 'Motivation';
  }

  // Default to Motivation when ambiguous (COM-B ordering: M > C > O)
  return 'Motivation';
}
