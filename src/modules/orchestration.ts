// Single entry point for all inbound user messages.
// Routes to onboarding or post-onboarding command handling.
import * as onboarding from './onboarding';
import * as profileStore from './profile';
import * as monitor from './monitor';
import * as db from './db';
import { chat } from '../services/chatter';
import { BotResult, ProfileUpdate, ProfileUpdateField, WaLocation } from '../types';

// ─── Natural language profile update detection ────────────────────────────────

interface FieldPattern {
  patterns: RegExp[];
  extract(m: RegExpMatchArray): ProfileUpdate | null;
}

// Parse a comma/and-separated list of times; returns sorted unique HH:MM array.
function parseMultipleTimes(str: string): string[] {
  const parts = str.split(/[,;&]|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const times: string[] = [];
  for (const part of parts) {
    const t = onboarding.parseTime(part);
    if (t) times.push(t);
  }
  return [...new Set(times)].sort();
}

// Resolve a plain-English timezone description to an IANA string, or null.
function detectTimezone(str: string): string | null {
  const s = str.toLowerCase();
  if (/eastern|\bet\b|est|edt/.test(s))  return 'America/New_York';
  if (/central|\bct\b|cst|cdt/.test(s))  return 'America/Chicago';
  if (/mountain|\bmt\b|mst|mdt/.test(s)) return 'America/Denver';
  if (/pacific|\bpt\b|pst|pdt/.test(s))  return 'America/Los_Angeles';
  const iana = str.match(/\b([A-Za-z_]+\/[A-Za-z_]+)\b/);
  if (iana) return iana[1];
  return null;
}

const FIELD_PATTERNS: FieldPattern[] = [
  // Sleep time
  {
    patterns: [
      /\bi\s+(?:actually\s+)?(?:go to bed|sleep|fall asleep)\s+at\s+([^\.,!?\n]+)/i,
      /\bmy\s+(?:bedtime|sleep time|bed time|quiet time)\s+is\s+(?:at\s+)?([^\.,!?\n]+)/i,
    ],
    extract(m) {
      const t = onboarding.parseTime(m[1].trim());
      return t ? { field: 'sleepTime' as ProfileUpdateField, value: t, label: 'sleep time', syncDb: true } : null;
    },
  },
  // Wake time
  {
    patterns: [
      /\bi\s+(?:actually\s+)?(?:wake up|get up|wake)\s+at\s+([^\.,!?\n]+)/i,
      /\bmy\s+(?:wake time|morning time|wake-up time)\s+is\s+(?:at\s+)?([^\.,!?\n]+)/i,
    ],
    extract(m) {
      const t = onboarding.parseTime(m[1].trim());
      return t ? { field: 'wakeTime' as ProfileUpdateField, value: t, label: 'wake time', syncDb: true } : null;
    },
  },
  // Reminder times
  {
    patterns: [
      /\b(?:remind(?:ers?)?\s+(?:me\s+)?at|set\s+(?:my\s+)?reminders?\s+to|i\s+want\s+reminders?\s+at|my\s+reminder\s+times?\s+(?:are|is))\s+([^\n]+)/i,
    ],
    extract(m) {
      const times = parseMultipleTimes(m[1]);
      return times.length ? { field: 'reminderTimes' as ProfileUpdateField, value: times, label: 'reminder times', syncDb: true } : null;
    },
  },
  // Timezone
  {
    patterns: [
      /\bi(?:'m|\s+am)\s+(?:actually\s+)?in\s+(.+?)(?:\s+time)?\s*$/i,
      /\bmy\s+(?:time\s*zone|timezone)\s+is\s+(.+)/i,
      /\bi\s+(?:actually\s+)?live\s+in\s+(.+)/i,
    ],
    extract(m) {
      const tz = detectTimezone(m[1]);
      return tz ? { field: 'timezone' as ProfileUpdateField, value: tz, label: 'timezone', syncDb: false } : null;
    },
  },
  // Tone (natural language beyond the "Tone: X" command)
  {
    patterns: [
      /\bi\s+(?:prefer|want|like)\s+(encouraging|empathetic|neutral)\b/i,
      /\bmake\s+(?:it|(?:my\s+)?reminders?)\s+(?:more\s+)?(encouraging|empathetic|neutral)\b/i,
      /\b(?:switch|change)\s+(?:(?:my\s+)?tone\s+)?to\s+(encouraging|empathetic|neutral)\b/i,
    ],
    extract(m) {
      return { field: 'tone' as ProfileUpdateField, value: m[1].toLowerCase(), label: 'tone', syncDb: false };
    },
  },
  // Name
  {
    patterns: [
      /\bcall\s+me\s+(\w+)/i,
      /\bmy\s+name\s+is\s+(\w+)/i,
    ],
    extract(m) {
      return { field: 'name' as ProfileUpdateField, value: m[1], label: 'name', syncDb: false };
    },
  },
];

function detectProfileUpdate(text: string): ProfileUpdate | null {
  for (const { patterns, extract } of FIELD_PATTERNS) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const result = extract(m);
        if (result) return result;
      }
    }
  }
  return null;
}

async function handleProfileUpdate(userId: string, update: ProfileUpdate): Promise<BotResult | null> {
  const p = profileStore.get(userId);
  if (!p) return null;

  switch (update.field) {
    case 'sleepTime':
      p.sleepTime = update.value as string;
      p.quietStart = update.value as string;
      break;
    case 'wakeTime':
      p.wakeTime = update.value as string;
      p.quietEnd = update.value as string;
      break;
    case 'reminderTimes':
      p.reminderTimes = update.value as string[];
      break;
    case 'timezone':
      p.timezone = update.value as string;
      break;
    case 'tone':
      p.tone = update.value as 'encouraging' | 'empathetic' | 'neutral';
      break;
    case 'name':
      p.name = update.value as string;
      break;
  }

  profileStore.upsert(userId, p);

  if (update.syncDb) {
    try {
      await onboarding.persistRoutine(userId, p);
    } catch (err) {
      console.error('DB sync error during profile update (non-fatal):', (err as Error).message);
    }
  }

  const confirmMessages: Record<ProfileUpdateField, string> = {
    sleepTime:     `✅ Got it — sleep time updated to *${update.value}*. I won't send reminders after that.`,
    wakeTime:      `✅ Got it — wake time updated to *${update.value}*. Reminders will start from then.`,
    reminderTimes: `✅ Reminder times updated to *${(update.value as string[]).join(', ')}*.`,
    timezone:      `✅ Timezone updated to *${update.value}*.`,
    tone:          `✅ Reminder style updated to *${update.value}*.`,
    name:          `✅ Got it — I'll call you *${update.value}* from now on.`,
  };

  return { messages: [confirmMessages[update.field]] };
}

// ─── Post-onboarding command handlers ────────────────────────────────────────

function handleTone(userId: string, tone: string): BotResult {
  profileStore.upsert(userId, { tone: tone as 'encouraging' | 'empathetic' | 'neutral' });
  return { messages: [`✅ Tone updated to *${tone}*.`] };
}

function handleHelp(): BotResult {
  return {
    messages: [
      `📋 *Medi Commands*\n\n` +
      `*Y* / *Yes* — log dose taken ✅\n` +
      `*N* / *No* — log dose missed ❌\n` +
      `*Stats* — see your adherence progress 📊\n` +
      `*Settings* — view your current setup ⚙️\n` +
      `*Pause [N days]* — pause reminders (default: today)\n` +
      `*Resume* — turn reminders back on\n` +
      `*Tone: encouraging|empathetic|neutral* — change reminder style\n` +
      `*Change [setting]* — update timezone, wake time, reminders, etc.\n` +
      `*Reset* — delete all your data and start over\n` +
      `*Help* — show this menu`,
    ],
  };
}

function handleStats(userId: string, tone: string = 'encouraging'): BotResult {
  const s = monitor.getSummary(userId, 7);
  if (s.totalDoses === 0) {
    return { messages: [`No doses logged yet. Reply *Y* after you take your medication and I'll start tracking your progress! 💊`] };
  }
  const rate = Math.round(s.adherenceRate * 100);
  const rateEmoji = rate >= 90 ? '🌟' : rate >= 70 ? '👍' : '💪';
  const lines = [
    `📊 *Your progress (last 7 days)*`,
    ``,
    `${rateEmoji} Adherence: ${rate}%`,
    `🔥 Current streak: ${s.currentStreak} day${s.currentStreak !== 1 ? 's' : ''}`,
    `🏆 Longest streak: ${s.longestStreak} day${s.longestStreak !== 1 ? 's' : ''}`,
    `✅ Taken: ${s.takenDoses}  ❌ Missed: ${s.missedDoses}`,
  ];
  if (s.recentBarriers.length > 0) {
    lines.push(``, `Recent challenges: ${s.recentBarriers.slice(-2).join('; ')}`);
  }
  if (tone === 'empathetic' && rate < 70) {
    lines.push(``, `Some weeks are harder. I'm here to help. 💙`);
  }
  return { messages: [lines.join('\n')] };
}

function handleSettings(userId: string): BotResult {
  const p = profileStore.get(userId);
  if (!p) return { messages: [`No profile found. Something went wrong.`] };

  const times     = (p.reminderTimes ?? []).join(', ') || 'not set';
  const tz        = p.timezone ?? 'not set';
  const tzDisplay = tz.replace(/_/g, ' ');
  const tone      = p.tone ?? 'encouraging';
  const qStart    = p.quietStart ?? '22:00';
  const qEnd      = p.quietEnd   ?? '07:00';
  const paused    = p.pausedUntil && new Date() < new Date(p.pausedUntil)
    ? `\n⏸️ Reminders paused until ${new Date(p.pausedUntil).toLocaleString()}`
    : '';

  return {
    messages: [
      `⚙️ *Your settings*\n\n` +
      `⏰ Reminders: ${times}\n` +
      `🌍 Timezone: ${tzDisplay}\n` +
      `💬 Tone: ${tone}\n` +
      `🌙 Quiet hours: ${qStart} – ${qEnd}` +
      paused +
      `\n\nSay *Change [setting]* to update anything.`,
    ],
  };
}

function handlePause(userId: string, lower: string): BotResult {
  const now = new Date();
  let until: Date;
  let label: string;

  const daysMatch = lower.match(/(\d+)\s*days?/);
  if (/week/.test(lower)) {
    until = new Date(now); until.setDate(until.getDate() + 7);
    label = '7 days';
  } else if (daysMatch) {
    const n = Math.min(parseInt(daysMatch[1]), 30);
    until = new Date(now); until.setDate(until.getDate() + n);
    label = `${n} day${n !== 1 ? 's' : ''}`;
  } else {
    // Default: rest of today
    until = new Date(now); until.setHours(23, 59, 59, 999);
    label = 'the rest of today';
  }

  profileStore.upsert(userId, { pausedUntil: until.toISOString() });
  return { messages: [`⏸️ Reminders paused for ${label}. Say *Resume* whenever you're ready.`] };
}

function handleResume(userId: string): BotResult {
  profileStore.upsert(userId, { pausedUntil: undefined });
  return { messages: [`▶️ Reminders are back on. I'll remind you at your scheduled times.`] };
}

const STREAK_MILESTONES = new Set([7, 14, 30, 60, 90, 180, 365]);

function milestoneMessage(streak: number, tone: string): string | null {
  if (!STREAK_MILESTONES.has(streak)) return null;
  if (tone === 'empathetic') return `💙 *${streak} days in a row* — that takes real effort. You should feel proud.`;
  if (tone === 'encouraging') return `🎉 *${streak}-day streak!* You're building a real habit. Keep it going!`;
  return `${streak}-day streak reached.`;
}

function buildLocalTime(timezone?: string): string {
  const now = new Date();
  return timezone
    ? now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: timezone })
    : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// ─── Main router ──────────────────────────────────────────────────────────────

async function processInbound(userId: string, text: string, location?: WaLocation): Promise<BotResult> {
  const lower = (text || '').trim().toLowerCase();
  const p = profileStore.get(userId);

  // Global reset — works at any stage
  if (lower === 'reset') {
    profileStore.remove(userId);
    monitor.clearUser(userId);
    await db.query('DELETE FROM routines WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM sent_log WHERE user_id = $1', [userId]);
    return { messages: ['🗑️ All your data has been deleted. Send any message to start fresh.'] };
  }

  // New user or mid-onboarding → route to onboarding state machine
  if (!p || !p.onboardingComplete) {
    const result = await onboarding.processMessage(userId, text, location);
    // Prepend a resumption greeting when a user returns mid-flow after a gap (>1 hour).
    // updatedAt is refreshed on every profile write, so this fires at most once per session.
    if (p && p.onboardingStep && p.onboardingStep !== 'WELCOME' && p.updatedAt) {
      const gapHours = (Date.now() - new Date(p.updatedAt).getTime()) / 3_600_000;
      if (gapHours >= 1) {
        result.messages = [`Welcome back! 👋 Let's pick up where we left off — you're almost done with setup.`, ...result.messages];
      }
    }
    return result;
  }

  // Pending barrier capture — must run before other command checks.
  // Y/N/Help clear the flag without capturing; any other text is the barrier reply.
  if (p.pendingBarrierCapture) {
    if (lower === 'y' || lower === 'yes' || lower === 'n' || lower === 'no' || lower === 'help') {
      profileStore.upsert(userId, { pendingBarrierCapture: false });
      // Fall through so Y/N are still processed normally below
    } else {
      const barrier = text.trim();
      monitor.amendLastBarrier(userId, barrier);
      profileStore.upsert(userId, { pendingBarrierCapture: false });
      return { messages: ["Thanks for sharing that. I've noted it to help personalise your support. 💙"] };
    }
  }

  // "change X" corrections re-enter onboarding at the relevant step
  if (/^change\s+/i.test(lower)) {
    return onboarding.processMessage(userId, text, location);
  }

  // Tone command
  const toneMatch = lower.match(/^tone:\s*(encouraging|empathetic|neutral)$/);
  if (toneMatch) return handleTone(userId, toneMatch[1]);

  // Adherence logging (Y / N) — resets the non-response counter
  if (lower === 'y' || lower === 'yes') {
    monitor.logDose(userId, true, { source: 'self_report' });
    profileStore.upsert(userId, {
      consecutiveNonResponses: 0,
      lastResponseAt: new Date().toISOString(),
      pendingBarrierCapture: false,
    });
    const tone    = p?.tone ?? 'encouraging';
    const trend   = monitor.getTrendMessage(userId, tone);
    const streak  = monitor.getSummary(userId, 400).currentStreak;
    const milestone = milestoneMessage(streak, tone);
    const messages = [`✅ Dose logged as taken. Keep it up!\n\n${trend}`];
    if (milestone) messages.push(milestone);
    return { messages };
  }
  if (lower === 'n' || lower === 'no') {
    monitor.logDose(userId, false, { source: 'self_report' });
    profileStore.upsert(userId, {
      consecutiveNonResponses: 0,
      lastResponseAt: new Date().toISOString(),
      pendingBarrierCapture: true,
    });
    return { messages: ["Got it. I've noted this dose as missed. You'll get a reminder next time. 💙\n\nWhat got in the way? (Optional — helps me personalise your reminders)"] };
  }

  if (lower === 'help') return handleHelp();

  if (lower === 'stats' || /^(how am i doing|my progress|my stats|show stats)$/i.test(lower)) {
    return handleStats(userId, p.tone);
  }

  if (lower === 'settings' || lower === 'status') {
    return handleSettings(userId);
  }

  if (/^(pause|snooze)(\s|$)/i.test(lower) || lower === 'pause' || lower === 'snooze') {
    return handlePause(userId, lower);
  }

  if (lower === 'resume') {
    return handleResume(userId);
  }

  // Natural language profile updates
  const profileUpdate = detectProfileUpdate(text);
  if (profileUpdate) {
    const updateResult = await handleProfileUpdate(userId, profileUpdate);
    if (updateResult) return updateResult;
  }

  // LLM chat fallback for anything not matched above
  try {
    const now     = new Date();
    const summary = monitor.getSummary(userId, 7);
    const result  = await chat({
      user_id:   userId,
      now_iso:   now.toISOString(),
      local_time: buildLocalTime(p.timezone),
      user_message: text,
      last_message: null,
      recent_adherence: {
        last_7: { taken: summary.takenDoses, missed: summary.missedDoses },
        streak: summary.currentStreak,
      },
      known_barriers: summary.recentBarriers,
      preferences: { tone: p.tone, name: p.name },
    });
    return { messages: [result.message] };
  } catch (err) {
    console.error('[orchestration] chat fallback error:', (err as Error).message);
    return {
      messages: [`I didn't quite catch that. Reply *Y* if you took your dose, *N* if you missed it, or *Help* for all commands.`],
    };
  }
}

export { processInbound };
