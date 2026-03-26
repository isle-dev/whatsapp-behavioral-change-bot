// Onboarding state machine for Medi — JITAI trait profile collection.
// Steps: WELCOME → TIMEZONE → MED_TIMING → CHECKIN_FREQ →
//        WEEKDAY_ROUTINE → MED_ANCHOR → STORAGE_LOCATION → MEMORY_AIDS →
//        WEEKEND_ROUTINE → SCHEDULE_TYPE →
//        YESTERDAY_ADHERENCE → [YESTERDAY_BARRIER] →
//        GENERAL_BARRIERS → SOCIAL_SUPPORT →
//        NECESSITY_BELIEF → CONCERNS_BELIEF → ILLNESS_UNDERSTANDING →
//        TONE → CONFIRM → DONE
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
  MedTiming,
  CheckinFrequency,
  SocialSupport,
  NecessityBelief,
  ConcernsBelief,
  IllnessUnderstanding,
  ReminderWindow,
  BotResult,
  InteractiveMessage,
  ParseResult,
} from '../types';

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  timezone: 'America/New_York',
  tone: 'encouraging' as ToneValue,
  medTiming: 'morning' as MedTiming,
  checkinFrequency: 'daily' as CheckinFrequency,
  quietStart: '22:00',
  quietEnd: '07:00',
  reminderTimes: ['08:00'],
};

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

// ─── Helper: map MedTiming to reminder times ─────────────────────────────────

function timesFromMedTiming(mt: MedTiming): string[] {
  switch (mt) {
    case 'morning':   return ['08:00'];
    case 'afternoon': return ['14:00'];
    case 'evening':   return ['20:00'];
    case 'varies':    return ['08:00', '20:00'];
  }
}

// ─── Kept for utility / test use ─────────────────────────────────────────────

const WINDOW_TIMES: Record<ReminderWindow, string> = {
  morning: '08:00',
  noon:    '12:00',
  evening: '18:00',
};

function buildTimesFromWindows(windows: ReminderWindow[]): string[] {
  return [...new Set((windows || []).map((w) => WINDOW_TIMES[w]).filter(Boolean))].sort();
}

// ─── Field → step mapping for "change X" corrections ────────────────────────

const FIELD_TO_STEP: Record<string, OnboardingStepName> = {
  'name':               'WELCOME',
  'timezone':           'TIMEZONE',
  'time zone':          'TIMEZONE',
  'medication time':    'MED_TIMING',
  'med time':           'MED_TIMING',
  'when i take':        'MED_TIMING',
  'check-in':           'CHECKIN_FREQ',
  'checkin':            'CHECKIN_FREQ',
  'check in':           'CHECKIN_FREQ',
  'frequency':          'CHECKIN_FREQ',
  'routine':            'WEEKDAY_ROUTINE',
  'weekday routine':    'WEEKDAY_ROUTINE',
  'anchor':             'MED_ANCHOR',
  'medication anchor':  'MED_ANCHOR',
  'storage':            'STORAGE_LOCATION',
  'location':           'STORAGE_LOCATION',
  'memory':             'MEMORY_AIDS',
  'memory aids':        'MEMORY_AIDS',
  'reminders':          'MEMORY_AIDS',
  'weekend':            'WEEKEND_ROUTINE',
  'weekend routine':    'WEEKEND_ROUTINE',
  'schedule':           'SCHEDULE_TYPE',
  'tone':               'TONE',
  'style':              'TONE',
};

function fieldToStep(raw: string): OnboardingStepName | null {
  return FIELD_TO_STEP[raw.toLowerCase().trim()] || null;
}

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS: Record<OnboardingStepName, OnboardingStep<unknown>> = {

  // ── Q1: Name ───────────────────────────────────────────────────────────────
  WELCOME: {
    prompt() {
      return {
        text: `Hi! I'm *Medi*, a support tool for staying on top of your blood pressure medication.\n\nI'll ask you a few questions to personalise your experience — it takes about 5 minutes.\n\nWhat would you like to be called? (or type *skip*)`,
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

  // ── Timezone (kept for scheduling) ────────────────────────────────────────
  TIMEZONE: {
    prompt(p) {
      const name = p && p.name ? `, ${p.name}` : '';
      return {
        text: `Great${name}! Which timezone are you in?\n\n1️⃣ Eastern (ET)\n2️⃣ Central (CT)\n3️⃣ Mountain (MT)\n4️⃣ Pacific (PT)\n5️⃣ Other\n\nReply with a number, or type your timezone (e.g., *America/Chicago*).\nType *skip* for Eastern.`,
        interactive: {
          type: 'button',
          body: { text: `Which timezone are you in${name}?` },
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
      if (input && input.trim().includes('/')) return { value: input.trim() };
      return { error: 'Please reply with a number (1–4) or type your timezone. Type *skip* for Eastern.' };
    },
    apply(value, p) {
      p.timezone = value as string;
      p.onboardingStep = 'MED_TIMING';
      return p;
    },
  },

  // ── Q2: Medication timing ─────────────────────────────────────────────────
  MED_TIMING: {
    prompt() {
      return {
        text: `When do you usually take your blood pressure medication?\n\n1️⃣ Morning\n2️⃣ Afternoon\n3️⃣ Evening\n4️⃣ It varies\n\nType *skip* for morning.`,
      };
    },
    parse(input): ParseResult<MedTiming> {
      const s = (input || '').trim().toLowerCase();
      if (s === '1' || s.includes('morning'))   return { value: 'morning' };
      if (s === '2' || s.includes('afternoon')) return { value: 'afternoon' };
      if (s === '3' || s.includes('evening'))   return { value: 'evening' };
      if (s === '4' || s.includes('varies') || s.includes('vary') || s.includes('different')) return { value: 'varies' };
      if (s === 'skip') return { value: DEFAULTS.medTiming };
      return { error: 'Please reply *1* (Morning), *2* (Afternoon), *3* (Evening), or *4* (It varies).' };
    },
    apply(value, p) {
      p.medTiming = value as MedTiming;
      p.reminderTimes = timesFromMedTiming(value as MedTiming);
      p.onboardingStep = 'CHECKIN_FREQ';
      return p;
    },
  },

  // ── Q3: Check-in frequency ────────────────────────────────────────────────
  CHECKIN_FREQ: {
    prompt() {
      return {
        text: `How often do you want me to check in with you?\n\n1️⃣ Every day\n2️⃣ A few times a week\n3️⃣ Once a week\n\nType *skip* for every day.`,
        interactive: {
          type: 'button',
          body: { text: 'How often would you like check-ins?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'freq_daily', title: 'Every day' } },
              { type: 'reply', reply: { id: 'freq_few',   title: 'A few times a week' } },
              { type: 'reply', reply: { id: 'freq_once',  title: 'Once a week' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<CheckinFrequency> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'freq_daily' || s === '1' || s.includes('every day') || s.includes('daily')) return { value: 'daily' };
      if (s === 'freq_few'   || s === '2' || s.includes('few'))  return { value: 'few_times_week' };
      if (s === 'freq_once'  || s === '3' || s.includes('once')) return { value: 'once_week' };
      if (s === 'skip') return { value: DEFAULTS.checkinFrequency };
      return { error: 'Please reply *1* (Every day), *2* (A few times a week), or *3* (Once a week).' };
    },
    apply(value, p) {
      p.checkinFrequency = value as CheckinFrequency;
      p.onboardingStep = 'WEEKDAY_ROUTINE';
      return p;
    },
  },

  // ── Q4: Weekday morning routine (open-ended) ──────────────────────────────
  WEEKDAY_ROUTINE: {
    prompt() {
      return {
        text: `Walk me through a typical weekday morning — what do you do from when you wake up until midday?\n\n(Type *skip* to continue.)`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim();
      if (s.toLowerCase() === 'skip') return { value: '' };
      return { value: s };
    },
    apply(value, p) {
      p.weekdayRoutine = value as string;
      p.onboardingStep = 'MED_ANCHOR';
      return p;
    },
  },

  // ── Q5: Medication anchor ─────────────────────────────────────────────────
  MED_ANCHOR: {
    prompt() {
      return {
        text: `What do you usually pair your medication with — something you do right before or after taking it?\n\n1️⃣ Breakfast\n2️⃣ Morning coffee\n3️⃣ Brushing teeth\n4️⃣ Bedtime routine\n5️⃣ Nothing specific\n\nType *skip* for nothing specific.`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === '1' || s.includes('breakfast')) return { value: 'breakfast' };
      if (s === '2' || s.includes('coffee'))    return { value: 'coffee' };
      if (s === '3' || s.includes('teeth') || s.includes('brush')) return { value: 'teeth' };
      if (s === '4' || s.includes('bedtime') || s.includes('bed')) return { value: 'bedtime' };
      if (s === '5' || s.includes('nothing') || s === 'skip') return { value: 'nothing' };
      return { error: 'Please reply *1–5* or describe what you pair your medication with.' };
    },
    apply(value, p) {
      p.medAnchor = value as string;
      p.onboardingStep = 'STORAGE_LOCATION';
      return p;
    },
  },

  // ── Q6: Storage location ──────────────────────────────────────────────────
  STORAGE_LOCATION: {
    prompt() {
      return {
        text: `Where do you keep your medication at home?\n\n1️⃣ Kitchen\n2️⃣ Bedroom\n3️⃣ Bathroom\n4️⃣ I carry it with me\n\nType *skip* for kitchen.`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === '1' || s.includes('kitchen') || s === 'skip') return { value: 'kitchen' };
      if (s === '2' || s.includes('bedroom')) return { value: 'bedroom' };
      if (s === '3' || s.includes('bathroom')) return { value: 'bathroom' };
      if (s === '4' || s.includes('carry') || s.includes('with me')) return { value: 'carry' };
      return { error: 'Please reply *1* (Kitchen), *2* (Bedroom), *3* (Bathroom), or *4* (I carry it with me).' };
    },
    apply(value, p) {
      p.storageLocation = value as string;
      p.onboardingStep = 'MEMORY_AIDS';
      return p;
    },
  },

  // ── Q7: Memory aids ───────────────────────────────────────────────────────
  MEMORY_AIDS: {
    prompt() {
      return {
        text: `Do you use anything to help you remember to take your medication?\n\n1️⃣ Phone alarm\n2️⃣ Pill organizer\n3️⃣ A family member or friend reminds me\n4️⃣ Nothing — I try to remember on my own\n\nType *skip* for nothing.`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === '1' || s.includes('alarm') || s.includes('phone')) return { value: 'alarm' };
      if (s === '2' || s.includes('organizer') || s.includes('organiser') || s.includes('pill')) return { value: 'organizer' };
      if (s === '3' || s.includes('family') || s.includes('friend') || s.includes('person')) return { value: 'person' };
      if (s === '4' || s.includes('nothing') || s === 'skip') return { value: 'nothing' };
      return { error: 'Please reply *1* (Phone alarm), *2* (Pill organizer), *3* (Family member), or *4* (Nothing).' };
    },
    apply(value, p) {
      p.memoryAids = value as string;
      p.onboardingStep = 'WEEKEND_ROUTINE';
      return p;
    },
  },

  // ── Q8: Weekend routine ───────────────────────────────────────────────────
  WEEKEND_ROUTINE: {
    prompt() {
      return {
        text: `Is your weekend routine different from your weekday routine?\n\n1️⃣ No, it's the same\n2️⃣ A little different\n3️⃣ Yes, quite different\n\nType *skip* for "the same".`,
        interactive: {
          type: 'button',
          body: { text: 'Is your weekend routine different from weekdays?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'wknd_same',      title: "No, it's the same" } },
              { type: 'reply', reply: { id: 'wknd_little',    title: 'A little different' } },
              { type: 'reply', reply: { id: 'wknd_different', title: 'Yes, quite different' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'wknd_same'  || s === '1' || s.includes('same') || s === 'skip') return { value: 'same' };
      if (s === 'wknd_little' || s === '2' || s.includes('little') || s.includes('bit')) return { value: 'little' };
      if (s === 'wknd_different' || s === '3' || s.includes('quite') || s.includes('different')) return { value: 'different' };
      return { error: 'Please reply *1* (Same), *2* (A little different), or *3* (Quite different).' };
    },
    apply(value, p) {
      p.weekendRoutineDiff = value as string;
      p.onboardingStep = 'SCHEDULE_TYPE';
      return p;
    },
  },

  // ── Q9: Schedule type ─────────────────────────────────────────────────────
  SCHEDULE_TYPE: {
    prompt() {
      return {
        text: `How would you describe your weekly schedule overall?\n\n1️⃣ Pretty consistent\n2️⃣ Varies a bit\n3️⃣ Very irregular (shift work, travel, etc.)\n\nType *skip* for "pretty consistent".`,
        interactive: {
          type: 'button',
          body: { text: 'How consistent is your weekly schedule?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'sched_consistent', title: 'Pretty consistent' } },
              { type: 'reply', reply: { id: 'sched_varies',     title: 'Varies a bit' } },
              { type: 'reply', reply: { id: 'sched_irregular',  title: 'Very irregular' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'sched_consistent' || s === '1' || s.includes('consistent') || s === 'skip') return { value: 'consistent' };
      if (s === 'sched_varies'     || s === '2' || s.includes('varies') || s.includes('bit'))    return { value: 'varies' };
      if (s === 'sched_irregular'  || s === '3' || s.includes('irregular') || s.includes('shift')) return { value: 'irregular' };
      return { error: 'Please reply *1* (Consistent), *2* (Varies a bit), or *3* (Very irregular).' };
    },
    apply(value, p) {
      p.scheduleType = value as string;
      p.onboardingStep = 'YESTERDAY_ADHERENCE';
      return p;
    },
  },

  // ── Q10: Yesterday's adherence ────────────────────────────────────────────
  YESTERDAY_ADHERENCE: {
    prompt() {
      return {
        text: `Did you take your medication yesterday?\n\n1️⃣ Yes\n2️⃣ No\n\nType *skip* for yes.`,
        interactive: {
          type: 'button',
          body: { text: 'Did you take your medication yesterday?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'yadh_yes', title: 'Yes' } },
              { type: 'reply', reply: { id: 'yadh_no',  title: 'No' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<boolean> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'yadh_yes' || s === '1' || s === 'yes' || s === 'y' || s === 'skip') return { value: true };
      if (s === 'yadh_no'  || s === '2' || s === 'no'  || s === 'n')                 return { value: false };
      return { error: 'Please reply *Yes* or *No*.' };
    },
    apply(value, p) {
      p.yesterdayAdherence = value as boolean;
      // If they missed it, ask why; otherwise skip straight to general barriers
      p.onboardingStep = value ? 'GENERAL_BARRIERS' : 'YESTERDAY_BARRIER';
      return p;
    },
  },

  // ── Q11: Yesterday's barrier (only if Q10 = No) ───────────────────────────
  YESTERDAY_BARRIER: {
    prompt() {
      return {
        text: `What got in the way yesterday?\n\n(Type *skip* to continue.)`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim();
      if (s.toLowerCase() === 'skip') return { value: '' };
      return { value: s };
    },
    apply(value, p) {
      p.yesterdayBarrier = value as string;
      p.onboardingStep = 'GENERAL_BARRIERS';
      return p;
    },
  },

  // ── Q12: General barriers (open-ended) ────────────────────────────────────
  GENERAL_BARRIERS: {
    prompt() {
      return {
        text: `In general, what makes it hardest for you to take your medication consistently? You can mention more than one thing.\n\n(Type *skip* to continue.)`,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim();
      if (s.toLowerCase() === 'skip') return { value: '' };
      return { value: s };
    },
    apply(value, p) {
      p.generalBarriers = value as string;
      p.onboardingStep = 'SOCIAL_SUPPORT';
      return p;
    },
  },

  // ── Q13: Social support ───────────────────────────────────────────────────
  SOCIAL_SUPPORT: {
    prompt() {
      return {
        text: `Does anyone in your household or close to you help you with your medication — reminders, picking up prescriptions, anything like that?\n\n1️⃣ Yes\n2️⃣ No\n3️⃣ I'd like some help but don't have it\n\nType *skip* for no.`,
        interactive: {
          type: 'button',
          body: { text: 'Does anyone help you with your medication?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'ss_yes',  title: 'Yes' } },
              { type: 'reply', reply: { id: 'ss_no',   title: 'No' } },
              { type: 'reply', reply: { id: 'ss_want', title: "I'd like help but don't have it" } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<SocialSupport> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'ss_yes'  || s === '1' || s === 'yes' || s === 'y') return { value: 'yes' };
      if (s === 'ss_no'   || s === '2' || s === 'no'  || s === 'n' || s === 'skip') return { value: 'no' };
      if (s === 'ss_want' || s === '3' || s.includes('like') || s.includes('want')) return { value: 'want_but_dont' };
      return { error: "Please reply *1* (Yes), *2* (No), or *3* (I'd like help but don't have it)." };
    },
    apply(value, p) {
      p.socialSupport = value as SocialSupport;
      p.onboardingStep = 'NECESSITY_BELIEF';
      return p;
    },
  },

  // ── Q14: Necessity belief ─────────────────────────────────────────────────
  NECESSITY_BELIEF: {
    prompt() {
      return {
        text: `How do you feel about your blood pressure medication overall?\n\n1️⃣ It's important — I take it seriously\n2️⃣ I take it but have some doubts\n3️⃣ Honestly, I'm not sure I need it\n\nType *skip* for "it's important".`,
        interactive: {
          type: 'button',
          body: { text: 'How do you feel about your blood pressure medication?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'nb_important', title: "It's important" } },
              { type: 'reply', reply: { id: 'nb_doubts',    title: 'I have some doubts' } },
              { type: 'reply', reply: { id: 'nb_notsure',   title: "I'm not sure I need it" } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<NecessityBelief> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'nb_important' || s === '1' || s.includes('important') || s === 'skip') return { value: 'important' };
      if (s === 'nb_doubts'    || s === '2' || s.includes('doubt'))  return { value: 'some_doubts' };
      if (s === 'nb_notsure'   || s === '3' || s.includes('not sure') || s.includes('unsure')) return { value: 'not_sure' };
      return { error: "Please reply *1*, *2*, or *3*." };
    },
    apply(value, p) {
      p.necessityBelief = value as NecessityBelief;
      p.onboardingStep = 'CONCERNS_BELIEF';
      return p;
    },
  },

  // ── Q15: Concerns belief ──────────────────────────────────────────────────
  CONCERNS_BELIEF: {
    prompt() {
      return {
        text: `Do you ever worry about taking it long term — like side effects or getting dependent on it?\n\n1️⃣ Not really\n2️⃣ A little\n3️⃣ Yes, quite a bit\n\nType *skip* for "not really".`,
        interactive: {
          type: 'button',
          body: { text: 'Do you worry about long-term effects of your medication?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'cb_notrly',  title: 'Not really' } },
              { type: 'reply', reply: { id: 'cb_little',  title: 'A little' } },
              { type: 'reply', reply: { id: 'cb_quite',   title: 'Yes, quite a bit' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<ConcernsBelief> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'cb_notrly' || s === '1' || s.includes('not really') || s === 'skip') return { value: 'not_really' };
      if (s === 'cb_little' || s === '2' || s.includes('little') || s.includes('bit')) return { value: 'a_little' };
      if (s === 'cb_quite'  || s === '3' || s.includes('quite') || s.includes('lot'))  return { value: 'quite_a_bit' };
      return { error: 'Please reply *1* (Not really), *2* (A little), or *3* (Yes, quite a bit).' };
    },
    apply(value, p) {
      p.concernsBelief = value as ConcernsBelief;
      p.onboardingStep = 'ILLNESS_UNDERSTANDING';
      return p;
    },
  },

  // ── Q16: Illness understanding ────────────────────────────────────────────
  ILLNESS_UNDERSTANDING: {
    prompt() {
      return {
        text: `Did you know that high blood pressure usually has no symptoms — you can feel completely fine and still be at risk?\n\n1️⃣ Yes, I knew that\n2️⃣ I'd heard something like that\n3️⃣ No, I didn't know that\n\nType *skip* for "yes, I knew that".`,
        interactive: {
          type: 'button',
          body: { text: 'Did you know high blood pressure usually has no symptoms?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'iu_knew',   title: 'Yes, I knew that' } },
              { type: 'reply', reply: { id: 'iu_heard',  title: "I'd heard something" } },
              { type: 'reply', reply: { id: 'iu_didnt',  title: "No, I didn't know" } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<IllnessUnderstanding> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'iu_knew'  || s === '1' || s.includes('knew') || s === 'skip') return { value: 'knew' };
      if (s === 'iu_heard' || s === '2' || s.includes('heard'))  return { value: 'heard' };
      if (s === 'iu_didnt' || s === '3' || s.includes("didn't") || s.includes('didnt') || s.includes('no')) return { value: 'didnt_know' };
      return { error: "Please reply *1*, *2*, or *3*." };
    },
    apply(value, p) {
      p.illnessUnderstanding = value as IllnessUnderstanding;
      p.onboardingStep = 'TONE';
      return p;
    },
  },

  // ── Tone preference ───────────────────────────────────────────────────────
  TONE: {
    prompt() {
      return {
        text: `How would you like your messages to feel?\n\n1️⃣ *Short and direct* — just the facts\n2️⃣ *Encouraging* — positive and motivating\n3️⃣ *Empathetic* — warm and caring\n\nType *skip* for encouraging.`,
        interactive: {
          type: 'button',
          body: { text: 'How would you like your messages to sound?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'tone_neutral',      title: 'Short and direct' } },
              { type: 'reply', reply: { id: 'tone_encouraging',  title: 'Encouraging' } },
              { type: 'reply', reply: { id: 'tone_empathetic',   title: 'Empathetic' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<ToneValue> {
      const s = (input || '').trim().toLowerCase();
      if (s === 'tone_neutral'     || s === '1' || s.includes('direct') || s.includes('neutral')) return { value: 'neutral' };
      if (s === 'tone_encouraging' || s === '2' || s.includes('encour')) return { value: 'encouraging' };
      if (s === 'tone_empathetic'  || s === '3' || s.includes('empath')) return { value: 'empathetic' };
      if (s === 'skip') return { value: DEFAULTS.tone };
      return { error: 'Please reply *1*, *2*, or *3*. Type *skip* for encouraging.' };
    },
    apply(value, p) {
      p.tone = value as ToneValue;
      p.onboardingStep = 'CONFIRM';
      return p;
    },
  },

  // ── Confirm & save ────────────────────────────────────────────────────────
  CONFIRM: {
    prompt(p) {
      const name = (p && p.name) ? p.name : 'there';
      const tz = (p && p.timezone) || DEFAULTS.timezone;
      const medTime = (p && p.medTiming) || DEFAULTS.medTiming;
      const freq = (p && p.checkinFrequency) || DEFAULTS.checkinFrequency;
      const freqLabel: Record<string, string> = {
        daily: 'Every day',
        few_times_week: 'A few times a week',
        once_week: 'Once a week',
      };
      const tone = (p && p.tone) || DEFAULTS.tone;

      return {
        text: `Here's your setup, ${name}:\n\n📍 *Timezone:* ${tz}\n💊 *Medication time:* ${medTime.charAt(0).toUpperCase() + medTime.slice(1)}\n📅 *Check-ins:* ${freqLabel[freq] || freq}\n💬 *Tone:* ${tone}\n\nType *confirm* to save, or *change [field]* to edit.\nFields: name, timezone, medication time, check-in frequency, tone`,
        interactive: {
          type: 'button',
          body: { text: `Here's your setup summary, ${name}. Ready to save?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'confirm_yes',     title: 'Looks good!' } },
              { type: 'reply', reply: { id: 'confirm_restart', title: 'Start over' } },
            ],
          },
        } as InteractiveMessage,
      };
    },
    parse(input): ParseResult<string> {
      const s = (input || '').trim().toLowerCase();
      if (['confirm_yes', 'confirm', 'yes', 'ok', 'done', 'save', 'looks good', 'looks good!'].includes(s)) {
        return { value: 'confirm' };
      }
      if (['confirm_restart', 'restart', 'start over'].includes(s)) {
        return { value: 'restart' };
      }
      const changeMatch = s.match(/^change\s+(?:my\s+)?(.+)$/);
      if (changeMatch) {
        const step = fieldToStep(changeMatch[1]);
        if (step) return { value: `goto:${step}` };
        return { error: 'I can change: name, timezone, medication time, check-in frequency, or tone. Which?' };
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
        const clearFields: (keyof Profile)[] = [
          'name', 'timezone', 'quietStart', 'quietEnd', 'reminderTimes', 'tone',
          'medTiming', 'checkinFrequency', 'weekdayRoutine', 'medAnchor',
          'storageLocation', 'memoryAids', 'weekendRoutineDiff', 'scheduleType',
          'yesterdayAdherence', 'yesterdayBarrier', 'generalBarriers',
          'socialSupport', 'necessityBelief', 'concernsBelief', 'illnessUnderstanding',
        ];
        clearFields.forEach((k) => { delete p[k]; });
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
        text: `All set, ${name}! I'll check in with you at your medication time.\n\nWhen I check in, reply:\n• *Y* or *Yes* — dose taken ✅\n• *N* or *No* — dose missed ❌\n• *Tone: encouraging* — change style\n• *Help* — all commands`,
      };
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const times = p.reminderTimes || timesFromMedTiming(p.medTiming || DEFAULTS.medTiming);
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
      p.quietStart || DEFAULTS.quietStart,
      p.quietEnd   || DEFAULTS.quietEnd,
      true,
    ]
  );
  if (result) {
    console.log(`✅ Routine persisted to DB for user ${userId}`);
  } else {
    console.log(`⚠️  No DB available; routine saved in profile JSON for user ${userId}`);
  }
}

async function persistTraitProfile(userId: string, p: Profile): Promise<void> {
  const result = await query(
    `INSERT INTO trait_profiles (
       user_id, med_timing, checkin_frequency, med_anchor, storage_location,
       memory_aids, weekend_routine_diff, schedule_type, yesterday_adherence,
       social_support, necessity_belief, concerns_belief, illness_understanding,
       weekday_routine, yesterday_barrier, general_barriers
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (user_id) DO UPDATE SET
       med_timing            = EXCLUDED.med_timing,
       checkin_frequency     = EXCLUDED.checkin_frequency,
       med_anchor            = EXCLUDED.med_anchor,
       storage_location      = EXCLUDED.storage_location,
       memory_aids           = EXCLUDED.memory_aids,
       weekend_routine_diff  = EXCLUDED.weekend_routine_diff,
       schedule_type         = EXCLUDED.schedule_type,
       yesterday_adherence   = EXCLUDED.yesterday_adherence,
       social_support        = EXCLUDED.social_support,
       necessity_belief      = EXCLUDED.necessity_belief,
       concerns_belief       = EXCLUDED.concerns_belief,
       illness_understanding = EXCLUDED.illness_understanding,
       weekday_routine       = EXCLUDED.weekday_routine,
       yesterday_barrier     = EXCLUDED.yesterday_barrier,
       general_barriers      = EXCLUDED.general_barriers,
       updated_at            = NOW()`,
    [
      userId,
      p.medTiming           ?? null,
      p.checkinFrequency    ?? null,
      p.medAnchor           ?? null,
      p.storageLocation     ?? null,
      p.memoryAids          ?? null,
      p.weekendRoutineDiff  ?? null,
      p.scheduleType        ?? null,
      p.yesterdayAdherence  ?? null,
      p.socialSupport       ?? null,
      p.necessityBelief     ?? null,
      p.concernsBelief      ?? null,
      p.illnessUnderstanding ?? null,
      p.weekdayRoutine      ?? null,
      p.yesterdayBarrier    ?? null,
      p.generalBarriers     ?? null,
    ]
  );
  if (result) {
    console.log(`✅ Trait profile persisted to DB for user ${userId}`);
  } else {
    console.log(`⚠️  No DB available; trait profile saved in profile JSON for user ${userId}`);
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

async function processMessage(userId: string, input: string): Promise<BotResult> {
  let p = profileStore.get(userId);
  if (!p) {
    p = { userId, onboardingStep: 'WELCOME', onboardingComplete: false, createdAt: new Date().toISOString() };
    profileStore.upsert(userId, p);
    return { messages: [STEPS.WELCOME.prompt(p).text] };
  }

  const raw = (input || '').trim();
  const lower = raw.toLowerCase();

  // ── Global commands ────────────────────────────────────────────────────────

  if (lower === 'help') {
    const step = p.onboardingStep || 'WELCOME';
    const stepDef = STEPS[step];
    const promptMsg = stepDef ? stepDef.prompt(p).text : '';
    return {
      messages: [
        `💡 *Help*\n\nType *skip* to use a default.\nType *restart* to start over.\nType *change [field]* to edit a previous answer.\nFields: name, timezone, medication time, check-in frequency, tone`,
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
    return { messages: [parsed.error] };
  }

  stepDef.apply!(parsed.value, p);
  profileStore.upsert(userId, p);

  await logResponse(userId, step, raw, parsed.value);

  // Onboarding just completed
  if (p.onboardingStep === 'DONE' || p.onboardingComplete) {
    await persistRoutine(userId, p);
    await persistTraitProfile(userId, p);
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
  persistTraitProfile,
  STEPS,
  DEFAULTS,
  buildTimesFromWindows,
};
