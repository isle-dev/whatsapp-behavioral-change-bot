import 'dotenv/config';

// ─── Isolate profile storage ──────────────────────────────────────────────────
jest.mock('../src/modules/profile', () => {
  const profiles: Record<string, unknown> = {};

  function get(userId: string) { return profiles[userId] || null; }
  function upsert(userId: string, updates: unknown) {
    profiles[userId] = { ...(profiles[userId] as object || {}), ...(updates as object), updatedAt: new Date().toISOString() };
    return profiles[userId];
  }
  function isOnboardingComplete(userId: string) {
    const p = profiles[userId] as { onboardingComplete?: boolean } | undefined;
    return !!(p && p.onboardingComplete);
  }
  function _reset() { Object.keys(profiles).forEach((k) => delete profiles[k]); }

  return { get, upsert, isOnboardingComplete, _reset };
});

// Stub DB so no real Postgres is needed
jest.mock('../src/modules/db', () => ({ query: async () => null }));

import {
  parseTime,
  STEPS,
  DEFAULTS,
  buildTimesFromWindows,
  processMessage,
  isComplete,
  getStep,
} from '../src/modules/onboarding';
import * as profileStore from '../src/modules/profile';

const store = profileStore as typeof profileStore & { _reset(): void };

afterEach(() => {
  store._reset();
});

// ─── Helper: skip all steps from current position to reach CONFIRM ────────────

async function skipToConfirm(uid: string): Promise<void> {
  await processMessage(uid, 'hi');      // first contact → WELCOME prompt
  await processMessage(uid, 'skip');    // name → TIMEZONE
  await processMessage(uid, 'skip');    // timezone → MED_TIMING
  await processMessage(uid, 'skip');    // med_timing → CHECKIN_FREQ
  await processMessage(uid, 'skip');    // checkin_freq → WEEKDAY_ROUTINE
  await processMessage(uid, 'skip');    // weekday_routine → MED_ANCHOR
  await processMessage(uid, 'skip');    // med_anchor → STORAGE_LOCATION
  await processMessage(uid, 'skip');    // storage_location → MEMORY_AIDS
  await processMessage(uid, 'skip');    // memory_aids → WEEKEND_ROUTINE
  await processMessage(uid, 'skip');    // weekend_routine → SCHEDULE_TYPE
  await processMessage(uid, 'skip');    // schedule_type → YESTERDAY_ADHERENCE
  await processMessage(uid, 'skip');    // yesterday_adherence (yes) → GENERAL_BARRIERS
  await processMessage(uid, 'skip');    // general_barriers → SOCIAL_SUPPORT
  await processMessage(uid, 'skip');    // social_support → NECESSITY_BELIEF
  await processMessage(uid, 'skip');    // necessity_belief → CONCERNS_BELIEF
  await processMessage(uid, 'skip');    // concerns_belief → ILLNESS_UNDERSTANDING
  await processMessage(uid, 'skip');    // illness_understanding → TONE
  await processMessage(uid, 'skip');    // tone → CONFIRM
}

// ─── parseTime ────────────────────────────────────────────────────────────────

describe('parseTime', () => {
  test.each([
    ['7am',    '07:00'],
    ['7:30am', '07:30'],
    ['07:30',  '07:30'],
    ['19:00',  '19:00'],
    ['7',      '07:00'],
    ['10pm',   '22:00'],
    ['10:30pm','22:30'],
    ['12pm',   '12:00'],
    ['12am',   '00:00'],
  ])('parseTime(%s) → %s', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  test.each(['abc', '25:00', '8:70', '99pm'])('parseTime(%s) → null', (input) => {
    expect(parseTime(input)).toBeNull();
  });
});

// ─── buildTimesFromWindows ────────────────────────────────────────────────────

describe('buildTimesFromWindows', () => {
  test('maps morning/noon/evening to times', () => {
    expect(buildTimesFromWindows(['morning', 'evening'])).toEqual(['08:00', '18:00']);
    expect(buildTimesFromWindows(['morning', 'noon', 'evening'])).toEqual(['08:00', '12:00', '18:00']);
  });

  test('ignores unknown windows', () => {
    expect(buildTimesFromWindows(['morning'] as never)).toEqual(['08:00']);
  });
});

// ─── Individual step parsers ──────────────────────────────────────────────────

describe('STEPS.WELCOME.parse', () => {
  test('returns null value for skip', () => {
    expect(STEPS.WELCOME.parse!('skip')).toEqual({ value: null });
    expect(STEPS.WELCOME.parse!('')).toEqual({ value: null });
  });

  test('returns name', () => {
    expect(STEPS.WELCOME.parse!('Alice')).toEqual({ value: 'Alice' });
  });

  test('rejects names longer than 50 chars', () => {
    const long = 'a'.repeat(51);
    expect(STEPS.WELCOME.parse!(long)).toHaveProperty('error');
  });
});

describe('STEPS.TIMEZONE.parse', () => {
  test('accepts numeric shortcuts', () => {
    expect(STEPS.TIMEZONE.parse!('1')).toEqual({ value: 'America/New_York' });
    expect(STEPS.TIMEZONE.parse!('2')).toEqual({ value: 'America/Chicago' });
    expect(STEPS.TIMEZONE.parse!('3')).toEqual({ value: 'America/Denver' });
    expect(STEPS.TIMEZONE.parse!('4')).toEqual({ value: 'America/Los_Angeles' });
  });

  test('accepts button IDs', () => {
    expect(STEPS.TIMEZONE.parse!('tz_eastern')).toEqual({ value: 'America/New_York' });
    expect(STEPS.TIMEZONE.parse!('tz_pacific')).toEqual({ value: 'America/Los_Angeles' });
  });

  test('accepts IANA timezone string', () => {
    expect(STEPS.TIMEZONE.parse!('Europe/London')).toEqual({ value: 'Europe/London' });
  });

  test('skip defaults to Eastern', () => {
    expect(STEPS.TIMEZONE.parse!('skip')).toEqual({ value: DEFAULTS.timezone });
  });

  test('returns error for unrecognised input', () => {
    expect(STEPS.TIMEZONE.parse!('blah')).toHaveProperty('error');
  });
});

describe('STEPS.MED_TIMING.parse', () => {
  test('accepts numeric and keyword inputs', () => {
    expect(STEPS.MED_TIMING.parse!('1')).toEqual({ value: 'morning' });
    expect(STEPS.MED_TIMING.parse!('2')).toEqual({ value: 'afternoon' });
    expect(STEPS.MED_TIMING.parse!('3')).toEqual({ value: 'evening' });
    expect(STEPS.MED_TIMING.parse!('4')).toEqual({ value: 'varies' });
    expect(STEPS.MED_TIMING.parse!('morning')).toEqual({ value: 'morning' });
  });

  test('skip defaults to morning', () => {
    expect(STEPS.MED_TIMING.parse!('skip')).toEqual({ value: 'morning' });
  });

  test('returns error for unrecognised input', () => {
    expect(STEPS.MED_TIMING.parse!('noon')).toHaveProperty('error');
  });
});

describe('STEPS.CHECKIN_FREQ.parse', () => {
  test('accepts numeric and keyword inputs', () => {
    expect(STEPS.CHECKIN_FREQ.parse!('1')).toEqual({ value: 'daily' });
    expect(STEPS.CHECKIN_FREQ.parse!('2')).toEqual({ value: 'few_times_week' });
    expect(STEPS.CHECKIN_FREQ.parse!('3')).toEqual({ value: 'once_week' });
    expect(STEPS.CHECKIN_FREQ.parse!('freq_daily')).toEqual({ value: 'daily' });
  });

  test('skip defaults to daily', () => {
    expect(STEPS.CHECKIN_FREQ.parse!('skip')).toEqual({ value: 'daily' });
  });
});

describe('STEPS.YESTERDAY_ADHERENCE.parse', () => {
  test('yes variants return true', () => {
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('yes')).toEqual({ value: true });
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('y')).toEqual({ value: true });
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('1')).toEqual({ value: true });
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('skip')).toEqual({ value: true });
  });

  test('no variants return false', () => {
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('no')).toEqual({ value: false });
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('n')).toEqual({ value: false });
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('2')).toEqual({ value: false });
  });

  test('returns error for unrecognised input', () => {
    expect(STEPS.YESTERDAY_ADHERENCE.parse!('maybe')).toHaveProperty('error');
  });
});

describe('STEPS.SOCIAL_SUPPORT.parse', () => {
  test('parses all three options', () => {
    expect(STEPS.SOCIAL_SUPPORT.parse!('1')).toEqual({ value: 'yes' });
    expect(STEPS.SOCIAL_SUPPORT.parse!('2')).toEqual({ value: 'no' });
    expect(STEPS.SOCIAL_SUPPORT.parse!('3')).toEqual({ value: 'want_but_dont' });
    expect(STEPS.SOCIAL_SUPPORT.parse!('ss_want')).toEqual({ value: 'want_but_dont' });
  });

  test('skip defaults to no', () => {
    expect(STEPS.SOCIAL_SUPPORT.parse!('skip')).toEqual({ value: 'no' });
  });
});

describe('STEPS.NECESSITY_BELIEF.parse', () => {
  test('parses all three options', () => {
    expect(STEPS.NECESSITY_BELIEF.parse!('1')).toEqual({ value: 'important' });
    expect(STEPS.NECESSITY_BELIEF.parse!('2')).toEqual({ value: 'some_doubts' });
    expect(STEPS.NECESSITY_BELIEF.parse!('3')).toEqual({ value: 'not_sure' });
  });

  test('skip defaults to important', () => {
    expect(STEPS.NECESSITY_BELIEF.parse!('skip')).toEqual({ value: 'important' });
  });
});

describe('STEPS.CONCERNS_BELIEF.parse', () => {
  test('parses all three options', () => {
    expect(STEPS.CONCERNS_BELIEF.parse!('1')).toEqual({ value: 'not_really' });
    expect(STEPS.CONCERNS_BELIEF.parse!('2')).toEqual({ value: 'a_little' });
    expect(STEPS.CONCERNS_BELIEF.parse!('3')).toEqual({ value: 'quite_a_bit' });
  });

  test('skip defaults to not_really', () => {
    expect(STEPS.CONCERNS_BELIEF.parse!('skip')).toEqual({ value: 'not_really' });
  });
});

describe('STEPS.ILLNESS_UNDERSTANDING.parse', () => {
  test('parses all three options', () => {
    expect(STEPS.ILLNESS_UNDERSTANDING.parse!('1')).toEqual({ value: 'knew' });
    expect(STEPS.ILLNESS_UNDERSTANDING.parse!('2')).toEqual({ value: 'heard' });
    expect(STEPS.ILLNESS_UNDERSTANDING.parse!('3')).toEqual({ value: 'didnt_know' });
  });

  test('skip defaults to knew', () => {
    expect(STEPS.ILLNESS_UNDERSTANDING.parse!('skip')).toEqual({ value: 'knew' });
  });
});

describe('STEPS.TONE.parse', () => {
  test('accepts numeric, keyword, and button ID inputs', () => {
    expect(STEPS.TONE.parse!('1')).toEqual({ value: 'neutral' });
    expect(STEPS.TONE.parse!('2')).toEqual({ value: 'encouraging' });
    expect(STEPS.TONE.parse!('3')).toEqual({ value: 'empathetic' });
    expect(STEPS.TONE.parse!('tone_encouraging')).toEqual({ value: 'encouraging' });
    expect(STEPS.TONE.parse!('tone_neutral')).toEqual({ value: 'neutral' });
    expect(STEPS.TONE.parse!('empathetic')).toEqual({ value: 'empathetic' });
  });

  test('skip defaults to encouraging', () => {
    expect(STEPS.TONE.parse!('skip')).toEqual({ value: 'encouraging' });
  });
});

describe('STEPS.CONFIRM.parse', () => {
  test('confirm returns confirm value', () => {
    expect(STEPS.CONFIRM.parse!('confirm')).toEqual({ value: 'confirm' });
    expect(STEPS.CONFIRM.parse!('confirm_yes')).toEqual({ value: 'confirm' });
    expect(STEPS.CONFIRM.parse!('yes')).toEqual({ value: 'confirm' });
  });

  test('restart returns restart value', () => {
    expect(STEPS.CONFIRM.parse!('restart')).toEqual({ value: 'restart' });
  });

  test('change field returns goto value', () => {
    expect(STEPS.CONFIRM.parse!('change timezone')).toEqual({ value: 'goto:TIMEZONE' });
    expect(STEPS.CONFIRM.parse!('change my tone')).toEqual({ value: 'goto:TONE' });
    expect(STEPS.CONFIRM.parse!('change medication time')).toEqual({ value: 'goto:MED_TIMING' });
  });

  test('unknown change field returns error', () => {
    expect(STEPS.CONFIRM.parse!('change something unknown')).toHaveProperty('error');
  });
});

// ─── Full state-machine walk-through ─────────────────────────────────────────

describe('processMessage — happy path', () => {
  const uid = 'test-user-happy';

  test('new user gets welcome prompt on first contact', async () => {
    const r = await processMessage(uid, 'anything');
    expect(r.messages[0]).toMatch(/Medi/);
    expect(getStep(uid)).toBe('WELCOME');
  });

  test('advances through WELCOME → TIMEZONE on name input', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    expect(getStep(uid)).toBe('TIMEZONE');
  });

  test('advances through TIMEZONE → MED_TIMING', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    await processMessage(uid, '1');
    expect(getStep(uid)).toBe('MED_TIMING');
  });

  test('YESTERDAY_ADHERENCE "no" routes to YESTERDAY_BARRIER', async () => {
    const uid2 = 'test-user-barrier';
    await processMessage(uid2, 'hi');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'skip');
    await processMessage(uid2, 'no');   // YESTERDAY_ADHERENCE = false → YESTERDAY_BARRIER
    expect(getStep(uid2)).toBe('YESTERDAY_BARRIER');
  });

  test('Complete happy path reaches DONE', async () => {
    await skipToConfirm(uid);
    const r = await processMessage(uid, 'confirm');
    expect(r.messages[0]).toMatch(/All set/);
    expect(isComplete(uid)).toBe(true);
  });
});

describe('processMessage — error recovery', () => {
  const uid = 'test-user-errors';

  test('bad timezone input returns error without advancing', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    const r = await processMessage(uid, 'blah');
    expect(r.messages[0]).toMatch(/number|timezone/i);
    expect(getStep(uid)).toBe('TIMEZONE');
  });

  test('bad med timing input returns error without advancing', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');  // timezone
    const r = await processMessage(uid, 'noon');
    expect(r.messages[0]).toMatch(/1|2|3|4/);
    expect(getStep(uid)).toBe('MED_TIMING');
  });
});

describe('processMessage — pause/resume', () => {
  const uid = 'test-user-resume';

  test('resumes from stored step after re-init', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Bob');
    expect(getStep(uid)).toBe('TIMEZONE');
    await processMessage(uid, '2');
    expect(getStep(uid)).toBe('MED_TIMING');
  });
});

describe('processMessage — corrections', () => {
  const uid = 'test-user-correct';

  test('"change timezone" jumps back to TIMEZONE from any step', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');  // past timezone
    const r = await processMessage(uid, 'change timezone');
    expect(getStep(uid)).toBe('TIMEZONE');
    expect(r.messages[0]).toMatch(/timezone/i);
  });

  test('"change tone" from CONFIRM jumps to TONE', async () => {
    await skipToConfirm(uid);
    expect(getStep(uid)).toBe('CONFIRM');
    const r = await processMessage(uid, 'change tone');
    expect(r.messages[0]).toMatch(/messages|sound/i);
    expect(getStep(uid)).toBe('TONE');
  });

  test('"change medication time" from CONFIRM jumps to MED_TIMING', async () => {
    await skipToConfirm(uid);
    const r = await processMessage(uid, 'change medication time');
    expect(getStep(uid)).toBe('MED_TIMING');
    expect(r.messages[0]).toMatch(/medication/i);
  });
});

describe('processMessage — global commands', () => {
  const uid = 'test-user-globals';

  test('"help" returns help text and re-prompts current step', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    const r = await processMessage(uid, 'help');
    expect(r.messages[0]).toMatch(/help/i);
  });

  test('"restart" resets to WELCOME', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    await processMessage(uid, '1');
    const r = await processMessage(uid, 'restart');
    expect(r.messages[0]).toMatch(/Starting over/i);
    expect(getStep(uid)).toBe('WELCOME');
  });
});

describe('Profile storage', () => {
  const uid = 'test-user-storage';

  test('JITAI trait fields are persisted after onboarding', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Carol');    // name
    await processMessage(uid, '1');        // timezone → Eastern
    await processMessage(uid, '1');        // med_timing → morning
    await processMessage(uid, '1');        // checkin_freq → daily
    await processMessage(uid, 'I wake up, make coffee, take my pills'); // weekday_routine
    await processMessage(uid, '1');        // med_anchor → breakfast
    await processMessage(uid, '1');        // storage → kitchen
    await processMessage(uid, '1');        // memory_aids → alarm
    await processMessage(uid, '1');        // weekend_routine → same
    await processMessage(uid, '1');        // schedule_type → consistent
    await processMessage(uid, 'no');       // yesterday_adherence → false → YESTERDAY_BARRIER
    await processMessage(uid, 'Forgot');   // yesterday_barrier
    await processMessage(uid, 'I forget in the morning'); // general_barriers
    await processMessage(uid, '1');        // social_support → yes
    await processMessage(uid, '1');        // necessity_belief → important
    await processMessage(uid, '1');        // concerns_belief → not_really
    await processMessage(uid, '1');        // illness_understanding → knew
    await processMessage(uid, '2');        // tone → encouraging
    await processMessage(uid, 'confirm');

    const p = profileStore.get(uid);
    expect(p!.name).toBe('Carol');
    expect(p!.timezone).toBe('America/New_York');
    expect(p!.medTiming).toBe('morning');
    expect(p!.checkinFrequency).toBe('daily');
    expect(p!.weekdayRoutine).toBe('I wake up, make coffee, take my pills');
    expect(p!.medAnchor).toBe('breakfast');
    expect(p!.storageLocation).toBe('kitchen');
    expect(p!.memoryAids).toBe('alarm');
    expect(p!.weekendRoutineDiff).toBe('same');
    expect(p!.scheduleType).toBe('consistent');
    expect(p!.yesterdayAdherence).toBe(false);
    expect(p!.yesterdayBarrier).toBe('Forgot');
    expect(p!.generalBarriers).toBe('I forget in the morning');
    expect(p!.socialSupport).toBe('yes');
    expect(p!.necessityBelief).toBe('important');
    expect(p!.concernsBelief).toBe('not_really');
    expect(p!.illnessUnderstanding).toBe('knew');
    expect(p!.tone).toBe('encouraging');
    expect(p!.reminderTimes).toEqual(['08:00']);
    expect(p!.onboardingComplete).toBe(true);
  });
});
