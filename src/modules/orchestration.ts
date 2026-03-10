// Single entry point for all inbound user messages.
// Routes to onboarding or post-onboarding command handling.
import * as onboarding from './onboarding';
import * as profileStore from './profile';
import { BotResult, ProfileUpdate, ProfileUpdateField } from '../types';

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
      `📋 *Medi Commands*\n\n*Y* / *Yes* — log dose taken ✅\n*N* / *No* — log dose missed ❌\n*Tone: encouraging|empathetic|neutral* — change reminder style\n*Change [setting]* — update timezone, wake time, reminders, etc.\n*Help* — show this menu`,
    ],
  };
}

// ─── Main router ──────────────────────────────────────────────────────────────

async function processInbound(userId: string, text: string): Promise<BotResult> {
  const lower = (text || '').trim().toLowerCase();
  const p = profileStore.get(userId);

  // New user or mid-onboarding → route to onboarding state machine
  if (!p || !p.onboardingComplete) {
    return onboarding.processMessage(userId, text);
  }

  // "change X" corrections re-enter onboarding at the relevant step
  if (/^change\s+/i.test(lower)) {
    return onboarding.processMessage(userId, text);
  }

  // Tone command
  const toneMatch = lower.match(/^tone:\s*(encouraging|empathetic|neutral)$/);
  if (toneMatch) return handleTone(userId, toneMatch[1]);

  // Adherence logging (Y / N)
  if (lower === 'y' || lower === 'yes') {
    return { messages: ['✅ Dose logged as taken. Keep it up!'] };
  }
  if (lower === 'n' || lower === 'no') {
    return { messages: ["Got it. I've noted this dose as missed. You'll get a reminder next time. 💙"] };
  }

  if (lower === 'help') return handleHelp();

  // Natural language profile updates
  const profileUpdate = detectProfileUpdate(text);
  if (profileUpdate) {
    const updateResult = await handleProfileUpdate(userId, profileUpdate);
    if (updateResult) return updateResult;
  }

  return {
    messages: [
      `I didn't quite catch that. Reply *Y* if you took your dose, *N* if you missed it, or *Help* for all commands.`,
    ],
  };
}

export { processInbound };
