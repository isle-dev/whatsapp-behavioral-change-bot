// Onboarding state machine for Medi.
// Steps: WELCOME → TIMEZONE → WAKE_TIME → SLEEP_TIME → REMINDER_WINDOWS
//        → [CUSTOM_TIMES] → TONE → CONFIRM → DONE
//
// Each step exposes:
//   prompt(profile)      → { text, interactive? }
//   parse(input, profile) → { value } | { error }
//   apply(value, profile) → mutated profile (sets onboardingStep for next step)
//
// Interactive messages are included for the WhatsApp Business API (buttons/list).
// The plain-text field is always the fallback used by whatsapp-web.js.

import * as profileStore from './profile';
import { query } from './db';
import {
  Profile,
  OnboardingStepName,
  OnboardingStep,
  ToneValue,
  ReminderWindow,
  BotResult,
  InteractiveMessage,
  ParseResult,
} from '../types';

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  timezone: 'America/New_York',
  wakeTime: '08:00',
  sleepTime: '22:00',
  reminderWindows: ['morning', 'evening'] as ReminderWindow[],
  reminderTimes: ['08:00', '18:00'],
  tone: 'encouraging' as ToneValue,
};

// ─── Local types ─────────────────────────────────────────────────────────────

type ReminderWindowsValue = { windows: ReminderWindow[]; needsCustom: boolean };

// ─── Time parser ─────────────────────────────────────────────────────────────
// Accepts: "7am", "7:30am", "19:00", "7:30", "7", "10pm", "10:30pm"

function parseTime(input: string): string | null {
  const s = (input || '').trim().toLowerCase();

  // HH:MM with optional am/pm
  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (hhmm) {
    let h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    const ap = hhmm[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Xam / Xpm
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const ap = ampm[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Bare hour
  const num = s.match(/^(\d{1,2})$/);
  if (num) {
    const h = parseInt(num[1], 10);
    if (h > 23) return null;
    return `${String(h).padStart(2, '0')}:00`;
  }

  return null;
}

// ─── Field → step mapping for "change X" corrections ────────────────────────

const FIELD_TO_STEP: Record<string, OnboardingStepName> = {
  'timezone':      'TIMEZONE',
  'time zone':     'TIMEZONE',
  'wake time':     'WAKE_TIME',
  'wake':          'WAKE_TIME',
  'morning time':  'WAKE_TIME',
  'sleep time':    'SLEEP_TIME',
  'sleep':         'SLEEP_TIME',
  'bedtime':       'SLEEP_TIME',
  'bed time':      'SLEEP_TIME',
  'quiet hours':   'SLEEP_TIME',
  'reminders':     'REMINDER_WINDOWS',
  'reminder times':'REMINDER_WINDOWS',
  'reminder':      'REMINDER_WINDOWS',
  'custom times':  'CUSTOM_TIMES',
  'tone':          'TONE',
  'style':         'TONE',
  'name':          'WELCOME',
};

function fieldToStep(raw: string): OnboardingStepName | null {
  return FIELD_TO_STEP[raw.toLowerCase().trim()] || null;
}

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS: Record<OnboardingStepName, OnboardingStep<unknown>> = {
  WELCOME: {
    prompt() {
      return {
        text: `👋 Hi! I'm *Medi*, your medication reminder assistant.\n\nI'll help you stay on track with your medications. Setup takes about 1 minute.\n\nWhat should I call you? (or type *skip*)`,
      };
    },
    parse(input): ParseResult<string | null> {
      const s = (input || '').trim();
      if (!s || s.toLowerCase() === 'skip') return { value: null };
      if (s.length > 50) return { error: 'That name is a bit long. Please use a shorter name, or type *skip*.' };
      return { value: s };
    },
    apply(value, p) {
      if (value) p.name = value as string;
      p.onboardingStep = 'TIMEZONE';
      return p;
    },
  },

  TIMEZONE: {
    prompt(p) {
      const name = p && p.name ? `, ${p.name}` : '';
      return {
        text: `Great${name}! 🌍 Which timezone are you in?\n\n1️⃣ Eastern (ET)\n2️⃣ Central (CT)\n3️⃣ Mountain (MT)\n4️⃣ Pacific (PT)\n5️⃣ Other\n\nReply with a number, or type your timezone (e.g., *America/Chicago*).\nType *skip* for Eastern.`,
        interactive: {
          type: 'button',
          body: { text: `Which timezone are you in${name}? Reply 1–4 or type your timezone.` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'tz_eastern', title: 'Eastern (ET)' } },
              { type: 'reply', reply: { id: 'tz_central', title: 'Central (CT)' } },
              { type: 'reply', reply: { id: 'tz_pacific', title: 'Pacific (PT)' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'tz_eastern' || s === '1' || s.includes('eastern')) return { value: 'America/New_York' };
      if (s === 'tz_central'  || s === '2' || s.includes('central'))  return { value: 'America/Chicago' };
      if (s === 'tz_mountain' || s === '3' || s.includes('mountain')) return { value: 'America/Denver' };
      if (s === 'tz_pacific'  || s === '4' || s.includes('pacific'))  return { value: 'America/Los_Angeles' };
      if (s === 'skip') return { value: DEFAULTS.timezone };
      if (s === '5' || s.includes('other')) {
        return { error: 'Please type your full timezone name (e.g., *Europe/London*, *Asia/Tokyo*):' };
      }
      // Accept any IANA-looking string (contains /)
      if (input && input.trim().includes('/')) return { value: input.trim() };
      return { error: 'Please reply with a number (1–4) or type your timezone. Type *skip* for Eastern.' };
    },
    apply(value, p) {
      p.timezone = value as string;
      p.onboardingStep = 'WAKE_TIME';
      return p;
    },
  },

  WAKE_TIME: {
    prompt() {
      return {
        text: `⏰ What time do you usually *wake up*?\n\nExamples: *7am*, *7:30am*, *07:30*\n\nType *skip* for 8:00am.`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'skip') return { value: DEFAULTS.wakeTime };
      const t = parseTime(s);
      if (!t) return { error: "I didn't understand that time. Try *7am*, *7:30am*, or *07:30*." };
      return { value: t };
    },
    apply(value, p) {
      p.wakeTime = value as string;
      p.quietEnd = value as string;
      p.onboardingStep = 'SLEEP_TIME';
      return p;
    },
  },

  SLEEP_TIME: {
    prompt() {
      return {
        text: `🌙 What time do you usually *go to bed*?\n\nI won't send reminders after this time.\n\nExamples: *10pm*, *22:00*\n\nType *skip* for 10:00pm.`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'skip') return { value: DEFAULTS.sleepTime };
      const t = parseTime(s);
      if (!t) return { error: "I didn't understand that time. Try *10pm*, *22:00*, or *22:30*." };
      return { value: t };
    },
    apply(value, p) {
      p.sleepTime = value as string;
      p.quietStart = value as string;
      p.onboardingStep = 'REMINDER_WINDOWS';
      return p;
    },
  },

  REMINDER_WINDOWS: {
    prompt() {
      return {
        text: `💊 When would you like medication reminders?\n\nReply with numbers (you can pick multiple):\n\n1️⃣ Morning (8:00am)\n2️⃣ Noon (12:00pm)\n3️⃣ Evening (6:00pm)\n4️⃣ Custom times\n\nExample: *1 3* for morning and evening.\nType *skip* for morning and evening.`,
      };
    },
    parse(input): ParseResult<ReminderWindowsValue> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'skip') return { value: { windows: ['morning', 'evening'], needsCustom: false } };

      const digits = s.match(/\d/g) || [];
      const windows: ReminderWindow[] = [];
      let needsCustom = false;

      for (const d of digits) {
        if (d === '1') windows.push('morning');
        else if (d === '2') windows.push('noon');
        else if (d === '3') windows.push('evening');
        else if (d === '4') needsCustom = true;
      }

      if (windows.length === 0 && !needsCustom) {
        return { error: 'Please reply with numbers like *1 3* (morning and evening). Type *skip* for defaults.' };
      }

      return { value: { windows: [...new Set(windows)], needsCustom } };
    },
    apply(value, p) {
      const v = value as ReminderWindowsValue;
      p.reminderWindows = v.windows;
      if (!v.needsCustom) {
        p.reminderTimes = buildTimesFromWindows(v.windows);
        p.onboardingStep = 'TONE';
      } else {
        p.onboardingStep = 'CUSTOM_TIMES';
      }
      return p;
    },
  },

  CUSTOM_TIMES: {
    prompt() {
      return {
        text: `⏱️ Enter your custom reminder times, separated by commas.\n\nExamples: *9:00am, 1:00pm, 8:00pm*\n\nType *skip* for 9am, 1pm, and 8pm.`,
      };
    },
    parse(input): ParseResult<string[]> {
      const s = (input || '').trim();
      if (s.toLowerCase() === 'skip') return { value: ['09:00', '13:00', '20:00'] };

      const parts = s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
      const times: string[] = [];
      for (const part of parts) {
        const t = parseTime(part.toLowerCase());
        if (!t) return { error: `Couldn't parse "${part}". Use formats like *9am*, *13:00*, or *8:00pm*.` };
        times.push(t);
      }

      if (times.length === 0) return { error: 'Please enter at least one time.' };
      return { value: times };
    },
    apply(value, p) {
      const times = value as string[];
      p.customTimes = times;
      p.reminderTimes = [...new Set([...(p.reminderTimes || []), ...times])].sort();
      p.onboardingStep = 'TONE';
      return p;
    },
  },

  TONE: {
    prompt() {
      return {
        text: `💬 How would you like reminders to feel?\n\n1️⃣ *Encouraging* — "You've got this! 💪"\n2️⃣ *Empathetic* — "Taking care of yourself matters 💙"\n3️⃣ *Neutral* — "Reminder: time for your medication"\n\nType *skip* for encouraging.`,
        interactive: {
          type: 'button',
          body: { text: 'How would you like your reminders to sound?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'tone_encouraging', title: '💪 Encouraging' } },
              { type: 'reply', reply: { id: 'tone_empathetic', title: '💙 Empathetic' } },
              { type: 'reply', reply: { id: 'tone_neutral', title: 'Neutral' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<ToneValue> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'tone_encouraging' || s === '1' || s.includes('encour')) return { value: 'encouraging' };
      if (s === 'tone_empathetic'  || s === '2' || s.includes('empath'))  return { value: 'empathetic' };
      if (s === 'tone_neutral'     || s === '3' || s.includes('neutral')) return { value: 'neutral' };
      if (s === 'skip') return { value: DEFAULTS.tone };
      return { error: 'Please reply *1*, *2*, or *3*. Type *skip* for encouraging.' };
    },
    apply(value, p) {
      p.tone = value as ToneValue;
      p.onboardingStep = 'CONFIRM';
      return p;
    },
  },

  CONFIRM: {
    prompt(p) {
      const name = (p && p.name) ? p.name : 'there';
      const tz = (p && p.timezone) || DEFAULTS.timezone;
      const wake = (p && p.wakeTime) || DEFAULTS.wakeTime;
      const sleep = (p && p.sleepTime) || DEFAULTS.sleepTime;
      const times = ((p && p.reminderTimes) || DEFAULTS.reminderTimes).join(', ');
      const tone = (p && p.tone) || DEFAULTS.tone;

      return {
        text: `✅ Here's your setup, ${name}:\n\n📍 *Timezone:* ${tz}\n⏰ *Wake time:* ${wake}\n🌙 *Quiet from:* ${sleep}\n💊 *Reminders at:* ${times}\n💬 *Tone:* ${tone}\n\nType *confirm* to save, or *change [field]* to edit.\nExamples: *change timezone*, *change tone*`,
        interactive: {
          type: 'button',
          body: { text: `Here's your setup summary, ${name}. Ready to save?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'confirm_yes', title: '✅ Looks good!' } },
              { type: 'reply', reply: { id: 'confirm_restart', title: '🔄 Start over' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (['confirm_yes', 'confirm', 'yes', 'ok', 'done', 'save', 'looks good', '✅ looks good!'].includes(s)) {
        return { value: 'confirm' };
      }
      if (['confirm_restart', 'restart', 'start over'].includes(s)) {
        return { value: 'restart' };
      }
      const changeMatch = s.match(/^change\s+(?:my\s+)?(.+)$/);
      if (changeMatch) {
        const step = fieldToStep(changeMatch[1]);
        if (step) return { value: `goto:${step}` };
        return { error: 'I can change: timezone, wake time, sleep time, reminders, or tone. Which?' };
      }
      return { error: 'Type *confirm* to save, *restart* to start over, or *change [field]* to edit.' };
    },
    apply(value, p) {
      const v = value as string;
      if (v === 'confirm') {
        p.onboardingStep = 'DONE';
        p.onboardingComplete = true;
      } else if (v === 'restart') {
        p.onboardingStep = 'WELCOME';
        p.onboardingComplete = false;
        // Clear collected data
        ((['name', 'timezone', 'wakeTime', 'sleepTime', 'quietStart', 'quietEnd',
          'reminderWindows', 'reminderTimes', 'customTimes', 'tone']) as (keyof Profile)[])
          .forEach((k) => { delete p[k]; });
      } else if (v.startsWith('goto:')) {
        p.onboardingStep = v.slice(5) as OnboardingStepName;
      }
      return p;
    },
  },

  DONE: {
    prompt(p) {
      const name = (p && p.name) ? p.name : 'there';
      return {
        text: `🎉 All set, ${name}! Your reminders are scheduled.\n\nWhen you get a reminder, reply:\n• *Y* or *Yes* — dose taken ✅\n• *N* or *No* — dose missed ❌\n• *Tone: encouraging* — change style\n• *Change [setting]* — update preferences\n• *Help* — all commands`,
      };
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WINDOW_TIMES: Record<ReminderWindow, string> = {
  morning: '08:00',
  noon:    '12:00',
  evening: '18:00',
};

function buildTimesFromWindows(windows: ReminderWindow[]): string[] {
  return [...new Set((windows || []).map((w) => WINDOW_TIMES[w]).filter(Boolean))].sort();
}

async function logResponse(
  userId: string,
  step: string,
  rawInput: string,
  parsedValue: unknown
): Promise<void> {
  let parsedStr: string | null;
  if (parsedValue === null || parsedValue === undefined) {
    parsedStr = null;
  } else if (typeof parsedValue === 'object') {
    parsedStr = JSON.stringify(parsedValue);
  } else {
    parsedStr = String(parsedValue);
  }

  await query(
    `INSERT INTO onboarding_responses (user_id, step, raw_input, parsed_value)
     VALUES ($1, $2, $3, $4)`,
    [userId, step, rawInput, parsedStr]
  );
}

async function persistRoutine(userId: string, p: Profile): Promise<void> {
  const times = p.reminderTimes || buildTimesFromWindows(p.reminderWindows || DEFAULTS.reminderWindows);
  const result = await query(
    `INSERT INTO routines (id, user_id, times, quiet_start, quiet_end, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       times       = EXCLUDED.times,
       quiet_start = EXCLUDED.quiet_start,
       quiet_end   = EXCLUDED.quiet_end,
       active      = EXCLUDED.active`,
    [
      userId,
      userId,
      times,
      p.quietStart || p.sleepTime || DEFAULTS.sleepTime,
      p.quietEnd   || p.wakeTime  || DEFAULTS.wakeTime,
      true,
    ]
  );
  if (result) {
    console.log(`✅ Routine persisted to DB for user ${userId}`);
  } else {
    console.log(`⚠️  No DB available; routine saved in profile JSON for user ${userId}`);
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

async function processMessage(userId: string, input: string): Promise<BotResult> {
  // First contact: greet without consuming the trigger message.
  let p = profileStore.get(userId);
  if (!p) {
    p = { userId, onboardingStep: 'WELCOME', onboardingComplete: false, createdAt: new Date().toISOString() };
    profileStore.upsert(userId, p);
    return { messages: [STEPS.WELCOME.prompt(p).text] };
  }

  const raw = (input || '').trim();
  const lower = raw.toLowerCase();

  // ── Global commands available at any step ──────────────────────────────────

  if (lower === 'help') {
    const step = p.onboardingStep || 'WELCOME';
    const stepDef = STEPS[step];
    const promptMsg = stepDef ? stepDef.prompt(p).text : '';
    return {
      messages: [
        `💡 *Help*\n\nType *skip* to use a default.\nType *restart* to start over.\nType *change [field]* to edit a previous answer.\nFields: timezone, wake time, sleep time, reminders, tone`,
        promptMsg,
      ].filter(Boolean),
    };
  }

  if (lower === 'restart') {
    p = { userId, onboardingStep: 'WELCOME', onboardingComplete: false, createdAt: p.createdAt };
    profileStore.upsert(userId, p);
    const msg = STEPS.WELCOME.prompt(p);
    return { messages: ['🔄 Starting over!', msg.text] };
  }

  // ── "change X" shortcut (outside CONFIRM step) ────────────────────────────
  const changeMatch = lower.match(/^change\s+(?:my\s+)?(.+)$/);
  if (changeMatch && p.onboardingStep !== 'CONFIRM') {
    const step = fieldToStep(changeMatch[1]);
    if (step) {
      p.onboardingStep = step;
      profileStore.upsert(userId, p);
      const msg = STEPS[step].prompt(p);
      return { messages: [msg.text], interactive: msg.interactive };
    }
  }

  // ── Step routing ──────────────────────────────────────────────────────────
  const step = p.onboardingStep || 'WELCOME';
  const stepDef = STEPS[step];

  if (!stepDef) {
    // Unknown step — reset
    p.onboardingStep = 'WELCOME';
    profileStore.upsert(userId, p);
    const msg = STEPS.WELCOME.prompt(p);
    return { messages: [msg.text] };
  }

  if (!stepDef.parse) {
    return { messages: ['✅ Setup complete!'] };
  }

  const parsed = stepDef.parse(raw, p);

  if ('error' in parsed) {
    // Re-prompt with the error
    return { messages: [parsed.error] };
  }

  stepDef.apply!(parsed.value, p);
  profileStore.upsert(userId, p);

  // Log the raw answer and its parsed value to Postgres for review
  await logResponse(userId, step, raw, parsed.value);

  // Onboarding just completed
  if (p.onboardingStep === 'DONE' || p.onboardingComplete) {
    await persistRoutine(userId, p);
    const doneMsg = STEPS.DONE.prompt(p);
    return { messages: [doneMsg.text] };
  }

  // Show next step's prompt
  const nextStep = p.onboardingStep;
  if (!nextStep) return { messages: ['✅ Setup complete!'] };
  const nextDef = STEPS[nextStep];
  if (!nextDef) return { messages: ['✅ Setup complete!'] };

  const nextMsg = nextDef.prompt(p);
  return { messages: [nextMsg.text], interactive: nextMsg.interactive };
}

function isComplete(userId: string): boolean {
  return profileStore.isOnboardingComplete(userId);
}

function getStep(userId: string): OnboardingStepName {
  const p = profileStore.get(userId);
  return p ? (p.onboardingStep || 'WELCOME') : 'WELCOME';
}

function getWelcomePrompt(): { text: string; interactive?: import('../types').InteractiveMessage } {
  return STEPS.WELCOME.prompt({});
}

export {
  processMessage,
  isComplete,
  getStep,
  getWelcomePrompt,
  parseTime,
  persistRoutine,
  STEPS,
  DEFAULTS,
  buildTimesFromWindows,
};
