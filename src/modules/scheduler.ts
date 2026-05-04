// Reminder scheduler — polls Postgres for due routines and fires the decision engine.
// Falls back gracefully to JSON-profile-based in-memory scheduling if DB is unavailable.
import * as db from './db';
import * as profileStore from './profile';
import * as monitor from './monitor';
import { decide } from '../services/decider';
import { Profile } from '../types';

export interface RoutineRow {
  id: string;
  user_id: string;
  times: string[];      // HH:MM strings
  days?: string[];      // Mon Tue Wed Thu Fri Sat Sun (optional; all days if absent)
  quiet_start?: string; // HH:MM
  quiet_end?: string;   // HH:MM
  active: boolean;
}

export interface DueRoutine {
  userId: string;
  routineId: string;
  scheduledTime: string; // HH:MM the reminder was scheduled for
  profile: Profile | null;
}

// ─── Quiet-hour guard ─────────────────────────────────────────────────────────

/**
 * Returns true if the current time (in the user's timezone) falls within quiet hours.
 * Defaults to 21:00–08:00 if no quiet hours are configured.
 */
export function isQuietHour(
  quietStart: string = '21:00',
  quietEnd: string   = '08:00',
  timezone?: string,
  now?: Date
): boolean {
  const d = now ?? new Date();

  // Get HH:MM in the user's timezone (or system time if not set)
  const localTimeStr = timezone
    ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: timezone })
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const [ch, cm] = localTimeStr.split(':').map(Number);
  const current = ch * 60 + cm;

  const [qsh, qsm] = quietStart.split(':').map(Number);
  const [qeh, qem] = quietEnd.split(':').map(Number);
  const start = qsh * 60 + qsm;
  const end   = qeh * 60 + qem;

  // Overnight window (e.g. 21:00 → 08:00)
  if (start > end) return current >= start || current < end;
  // Same-day window (e.g. 13:00 → 14:00)
  return current >= start && current < end;
}

/**
 * Returns true if the current time (HH:MM in the user's timezone) is within
 * ±10 minutes of a scheduled reminder time. This loose window prevents missed
 * reminders due to polling jitter.
 */
export function isWithinWindow(scheduledHHMM: string, timezone?: string, windowMinutes = 10, now?: Date): boolean {
  const d = now ?? new Date();
  const localTimeStr = timezone
    ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: timezone })
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const [ch, cm] = localTimeStr.split(':').map(Number);
  const [sh, sm] = scheduledHHMM.split(':').map(Number);
  const diff = Math.abs((ch * 60 + cm) - (sh * 60 + sm));
  return diff <= windowMinutes || diff >= (24 * 60 - windowMinutes); // handle midnight wrap
}

// ─── Day-of-week helper ───────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayDOW(timezone?: string): string {
  const d = new Date();
  if (!timezone) return DOW[d.getDay()];
  const locale = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone });
  return locale.substring(0, 3);
}

// ─── DB-backed scheduling ────────────────────────────────────────────────────

/**
 * Persist (upsert) a user's reminder routine into Postgres.
 * Replaces the old row for this userId.
 */
export async function upsertRoutine(userId: string, profile: Partial<Profile>): Promise<void> {
  const times: string[] = profile.reminderTimes ?? [];
  if (times.length === 0) return;

  const sql = `
    INSERT INTO routines (id, user_id, times, quiet_start, quiet_end, active)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (id) DO UPDATE
      SET times       = EXCLUDED.times,
          quiet_start = EXCLUDED.quiet_start,
          quiet_end   = EXCLUDED.quiet_end,
          active      = true
  `;

  await db.query(sql, [
    userId,                            // id = userId (one routine per user for now)
    userId,
    times,
    profile.quietStart ?? '21:00',
    profile.quietEnd   ?? '08:00',
  ]);
}

/**
 * Deactivate a user's routine (e.g., they opted out or completed the study).
 */
export async function deactivateRoutine(userId: string): Promise<void> {
  await db.query('UPDATE routines SET active = false WHERE user_id = $1', [userId]);
}

/**
 * Query Postgres for all active routines and return those whose scheduled
 * reminder time is currently within the dispatch window and not in quiet hours.
 */
export async function getDueRoutines(now?: Date): Promise<DueRoutine[]> {
  const result = await db.query(
    'SELECT id, user_id, times, days, quiet_start, quiet_end, active FROM routines WHERE active = true'
  );

  if (!result || result.rows.length === 0) {
    // Fallback: use JSON profiles when DB unavailable
    return getDueRoutinesFromProfiles(now);
  }

  const due: DueRoutine[] = [];
  for (const row of result.rows as RoutineRow[]) {
    const profile = profileStore.get(row.user_id);
    const tz = profile?.timezone;

    // Day-of-week filter
    if (row.days && row.days.length > 0 && !row.days.includes(todayDOW(tz))) continue;

    // Quiet-hour check
    if (isQuietHour(row.quiet_start, row.quiet_end, tz, now)) continue;

    // Window check for each scheduled time
    for (const t of row.times) {
      if (isWithinWindow(t, tz, 10, now)) {
        due.push({ userId: row.user_id, routineId: row.id, scheduledTime: t, profile });
      }
    }
  }

  return due;
}

/**
 * Fallback scheduler: reads JSON profiles directly when Postgres is unavailable.
 * Used in demo/offline mode.
 */
function getDueRoutinesFromProfiles(now?: Date): DueRoutine[] {
  // profileStore doesn't expose a getAll(), so we read the file directly
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const profilesPath = path.join(__dirname, '../../data/profiles.json');

  if (!fs.existsSync(profilesPath)) return [];

  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8')) as Record<string, Profile>;
  const due: DueRoutine[] = [];

  for (const [userId, profile] of Object.entries(profiles)) {
    if (!profile.onboardingComplete) continue;
    const times = profile.reminderTimes ?? [];
    if (times.length === 0) continue;

    const tz = profile.timezone;
    if (isQuietHour(profile.quietStart, profile.quietEnd, tz, now)) continue;

    for (const t of times) {
      if (isWithinWindow(t, tz, 10, now)) {
        due.push({ userId, routineId: `json:${userId}`, scheduledTime: t, profile });
      }
    }
  }

  return due;
}

// ─── Sent-log helpers (DB-backed, in-memory fallback) ────────────────────────

// In-memory fallback used when the DB is unavailable.
const inMemorySentFallback: Record<string, boolean> = {};

function todayDate(timezone?: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone ?? 'UTC' }); // YYYY-MM-DD
}

async function hasSentToday(userId: string, scheduledTime: string, timezone?: string): Promise<boolean> {
  const date = todayDate(timezone);
  const key = `${userId}:${scheduledTime}:${date}`;
  try {
    const result = await db.query(
      'SELECT 1 FROM sent_log WHERE user_id = $1 AND scheduled_time = $2 AND sent_date = $3',
      [userId, scheduledTime, date]
    );
    return (result?.rows.length ?? 0) > 0;
  } catch {
    return !!inMemorySentFallback[key];
  }
}

async function markSent(userId: string, scheduledTime: string, timezone?: string): Promise<void> {
  const date = todayDate(timezone);
  const key = `${userId}:${scheduledTime}:${date}`;
  inMemorySentFallback[key] = true;
  try {
    await db.query(
      'INSERT INTO sent_log (user_id, scheduled_time, sent_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, scheduledTime, date]
    );
  } catch {
    // DB unavailable — in-memory fallback already set
  }
}

// ─── Follow-up nudge ──────────────────────────────────────────────────────────

type SendFn = (userId: string, message: string) => Promise<void>;

// Sent 2–4 hours after a reminder that received no Y/N reply, once per day.
async function sendFollowUpNudges(sendFn: SendFn): Promise<void> {
  const allProfiles = profileStore.getAll();
  const now = new Date();

  for (const profile of Object.values(allProfiles)) {
    if (!profile.onboardingComplete || !profile.lastReminderSentAt) continue;

    const lastReply = profile.lastResponseAt ? new Date(profile.lastResponseAt) : null;
    const lastSent  = new Date(profile.lastReminderSentAt);

    // Skip if the user already replied since the last reminder
    if (lastReply && lastReply >= lastSent) continue;

    const hoursElapsed = (now.getTime() - lastSent.getTime()) / 3_600_000;
    if (hoursElapsed < 2 || hoursElapsed > 4) continue;

    // Only one nudge per day
    const today = todayDate(profile.timezone);
    if (profile.followUpSentAt === today) continue;

    // Respect quiet hours and pause
    if (isQuietHour(profile.quietStart, profile.quietEnd, profile.timezone)) continue;
    if (profile.pausedUntil && now < new Date(profile.pausedUntil)) continue;

    const name = profile.name ?? 'there';
    const tone = profile.tone ?? 'encouraging';
    let nudge: string;
    if (tone === 'empathetic') {
      nudge = `Hi ${name} — just checking in. Did you get a chance to take your medication? Reply *Y* or *N* 💙`;
    } else if (tone === 'encouraging') {
      nudge = `Hey ${name}! Did you manage to take your medication earlier? Reply *Y* if you did, *N* if not 💊`;
    } else {
      nudge = `Follow-up: did you take your medication? Reply *Y* taken / *N* missed.`;
    }

    try {
      await sendFn(profile.userId, nudge);
      profileStore.upsert(profile.userId, { followUpSentAt: today });
      console.log(`[scheduler] Sent follow-up nudge to ${profile.userId}`);
    } catch (err) {
      console.error(`[scheduler] Follow-up nudge error for ${profile.userId}:`, (err as Error).message);
    }
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

/**
 * Start the scheduler polling loop.
 * Calls `sendFn` whenever a routine is due and passes it the generated reminder.
 * Polling interval is 5 minutes by default.
 *
 * @param sendFn - Async function that delivers a message to the user
 * @param intervalMs - Polling interval in milliseconds (default: 5 min)
 */
export function startPolling(sendFn: SendFn, intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  console.log(`[scheduler] Polling every ${intervalMs / 1000}s for due routines`);

  const tick = async () => {
    try {
      await sendFollowUpNudges(sendFn);

      const due = await getDueRoutines();
      for (const { userId, scheduledTime, profile } of due) {
        // Skip if the user has paused reminders
        if (profile?.pausedUntil && new Date() < new Date(profile.pausedUntil)) continue;

        if (await hasSentToday(userId, scheduledTime, profile?.timezone)) continue;

        // If lastReminderSentAt is still set the user hasn't replied since the previous send.
        let nonResponses = profile?.consecutiveNonResponses ?? 0;
        const lastSent    = profile?.lastReminderSentAt;
        const lastReply   = profile?.lastResponseAt;
        const noReply     = lastSent && (!lastReply || lastReply < lastSent);
        if (noReply) {
          nonResponses += 1;
          profileStore.upsert(userId, { consecutiveNonResponses: nonResponses });
        }

        const now = new Date();
        const tz  = profile?.timezone;
        const localTime = tz
          ? now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: tz })
          : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const summary        = monitor.getSummary(userId, 7);
        const reminderTimes  = profile?.reminderTimes ?? [scheduledTime];
        const [hour]         = scheduledTime.split(':').map(Number);
        const decisionPoint: 'morning' | 'evening' = hour < 12 ? 'morning' : 'evening';

        let message: string;
        try {
          const decision = await decide({
            user_id:                  userId,
            now_iso:                  now.toISOString(),
            local_time:               localTime,
            is_quiet_hours:           false, // already filtered by getDueRoutines
            decision_point:           decisionPoint,
            consecutive_nonresponses: nonResponses,
            recent_adherence: {
              last_7: { taken: summary.takenDoses, missed: summary.missedDoses },
              streak: summary.currentStreak,
            },
            last_message:   null,
            last_user_reply: null,
            known_barriers: summary.recentBarriers,
            preferences:    { tone: profile?.tone, name: profile?.name },
            windows: {
              morning_window: reminderTimes[0] ?? '08:00',
              evening_window: reminderTimes[reminderTimes.length - 1] ?? '20:00',
            },
          });

          if (!decision.send) {
            console.log(`[scheduler] Skipped send for ${userId} (${decision.reason_codes.join(', ')})`);
            // Mark the slot so this window isn't re-evaluated on the next poll tick.
            await markSent(userId, scheduledTime, profile?.timezone);
            continue;
          }
          message = decision.long_message;
        } catch (err) {
          console.error(`[scheduler] Decision engine error for ${userId}, using fallback:`, (err as Error).message);
          message = buildReminderMessage(profile);
        }

        await sendFn(userId, message);
        await markSent(userId, scheduledTime, profile?.timezone);
        profileStore.upsert(userId, { lastReminderSentAt: now.toISOString() });
        console.log(`[scheduler] Sent reminder to ${userId} for window ${scheduledTime}`);
      }
    } catch (err) {
      console.error('[scheduler] Tick error:', (err as Error).message);
    }
  };

  // Run immediately, then on interval
  tick();
  return setInterval(tick, intervalMs);
}

// ─── Reminder message builder ─────────────────────────────────────────────────

/**
 * Generate a lightweight reminder message from the user profile.
 * The full LLM-powered version is in services/decider.ts; this is a fast
 * rule-based fallback used when the LLM is unavailable or for demos.
 */
export function buildReminderMessage(profile: Profile | null): string {
  const name    = profile?.name ?? 'there';
  const tone    = profile?.tone ?? 'encouraging';
  const trend   = profile ? monitor.getTrendMessage(profile.userId, tone) : '';
  const anchor  = profile?.medAnchor ?? '';
  const storage = profile?.storageLocation ?? '';

  const anchorHint = anchor && anchor !== 'nothing'
    ? ` Tip: pair it with ${anchor}.`
    : '';

  const storageHint = storage && storage !== 'carry'
    ? ` Your medication is in the ${storage}.`
    : '';

  if (tone === 'encouraging') {
    return `Hey ${name}! 💊 Time for your medication.${anchorHint}${storageHint}\n\n${trend}\n\nReply *Y* when you've taken it!`;
  }
  if (tone === 'empathetic') {
    return `Hi ${name} — just a gentle reminder to take your medication. 💙${anchorHint}${storageHint}\n\n${trend}\n\nNo pressure — just reply *Y* when you're ready.`;
  }
  // neutral
  return `Medication reminder.${anchorHint}\n\nReply *Y* taken / *N* missed.`;
}
