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

describe('STEPS.WAKE_TIME.parse', () => {
  test('parses valid times', () => {
    expect(STEPS.WAKE_TIME.parse!('7am')).toEqual({ value: '07:00' });
    expect(STEPS.WAKE_TIME.parse!('7:30am')).toEqual({ value: '07:30' });
  });

  test('skip returns default', () => {
    expect(STEPS.WAKE_TIME.parse!('skip')).toEqual({ value: DEFAULTS.wakeTime });
  });

  test('invalid time returns error', () => {
    expect(STEPS.WAKE_TIME.parse!('foobar')).toHaveProperty('error');
  });
});

describe('STEPS.SLEEP_TIME.parse', () => {
  test('parses pm times correctly', () => {
    expect(STEPS.SLEEP_TIME.parse!('10pm')).toEqual({ value: '22:00' });
    expect(STEPS.SLEEP_TIME.parse!('22:00')).toEqual({ value: '22:00' });
  });
});

describe('STEPS.REMINDER_WINDOWS.parse', () => {
  test('parses multi-number selection', () => {
    const r = STEPS.REMINDER_WINDOWS.parse!('1 3') as { value: { windows: string[]; needsCustom: boolean } };
    expect(r.value.windows).toEqual(['morning', 'evening']);
    expect(r.value.needsCustom).toBe(false);
  });

  test('4 triggers custom times', () => {
    const r = STEPS.REMINDER_WINDOWS.parse!('4') as { value: { needsCustom: boolean } };
    expect(r.value.needsCustom).toBe(true);
  });

  test('empty input returns error', () => {
    expect(STEPS.REMINDER_WINDOWS.parse!('')).toHaveProperty('error');
  });

  test('skip returns morning + evening', () => {
    const r = STEPS.REMINDER_WINDOWS.parse!('skip') as { value: { windows: string[] } };
    expect(r.value.windows).toEqual(['morning', 'evening']);
  });
});

describe('STEPS.CUSTOM_TIMES.parse', () => {
  test('parses comma-separated times', () => {
    const r = STEPS.CUSTOM_TIMES.parse!('9am, 1pm, 8pm') as { value: string[] };
    expect(r.value).toEqual(['09:00', '13:00', '20:00']);
  });

  test('invalid time returns error', () => {
    expect(STEPS.CUSTOM_TIMES.parse!('foo, 8pm')).toHaveProperty('error');
  });
});

describe('STEPS.TONE.parse', () => {
  test('accepts numeric and keyword', () => {
    expect(STEPS.TONE.parse!('1')).toEqual({ value: 'encouraging' });
    expect(STEPS.TONE.parse!('empathetic')).toEqual({ value: 'empathetic' });
    expect(STEPS.TONE.parse!('tone_neutral')).toEqual({ value: 'neutral' });
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
  });

  test('unknown change field returns error', () => {
    expect(STEPS.CONFIRM.parse!('change something unknown')).toHaveProperty('error');
  });
});

// ─── Full state-machine walk-through ─────────────────────────────────────────

describe('processMessage — happy path', () => {
  const uid = 'test-user-happy';

  test('WELCOME: new user gets welcome prompt on first contact', async () => {
    const r = await processMessage(uid, 'anything');
    expect(r.messages[0]).toMatch(/Medi/);
    expect(getStep(uid)).toBe('WELCOME');
  });

  test('TIMEZONE: advances on valid input after name', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    await processMessage(uid, '1');
    expect(getStep(uid)).toBe('WAKE_TIME');
  });

  test('WAKE_TIME: advances on valid time', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    await processMessage(uid, '1');
    await processMessage(uid, '7am');
    expect(getStep(uid)).toBe('SLEEP_TIME');
  });

  test('Complete happy path reaches DONE', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Alice');
    await processMessage(uid, '1');
    await processMessage(uid, '7am');
    await processMessage(uid, '10pm');
    await processMessage(uid, '1 3');
    await processMessage(uid, '1');
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

  test('bad time input returns error without advancing', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    const r = await processMessage(uid, 'not a time');
    expect(r.messages[0]).toMatch(/didn't understand|try/i);
    expect(getStep(uid)).toBe('WAKE_TIME');
  });
});

describe('processMessage — pause/resume', () => {
  const uid = 'test-user-resume';

  test('resumes from stored step after re-init', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Bob');
    const step = getStep(uid);
    expect(step).toBe('TIMEZONE');
    await processMessage(uid, '2');
    expect(getStep(uid)).toBe('WAKE_TIME');
  });
});

describe('processMessage — corrections', () => {
  const uid = 'test-user-correct';

  test('"change timezone" jumps back to TIMEZONE from any step', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    const r = await processMessage(uid, 'change timezone');
    expect(getStep(uid)).toBe('TIMEZONE');
    expect(r.messages[0]).toMatch(/timezone/i);
  });

  test('"change tone" from CONFIRM jumps to TONE', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, '1 3');
    await processMessage(uid, 'skip');
    expect(getStep(uid)).toBe('CONFIRM');
    const r = await processMessage(uid, 'change tone');
    expect(r.messages[0]).toMatch(/reminders|sound/i);
    expect(getStep(uid)).toBe('TONE');
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

describe('processMessage — custom times path', () => {
  const uid = 'test-user-custom';

  test('selecting option 4 routes through CUSTOM_TIMES', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, 'skip');
    await processMessage(uid, '4');
    expect(getStep(uid)).toBe('CUSTOM_TIMES');
    await processMessage(uid, '9am, 2pm, 8pm');
    expect(getStep(uid)).toBe('TONE');
  });
});

describe('Profile storage', () => {
  const uid = 'test-user-storage';

  test('profile is persisted with correct fields after onboarding', async () => {
    await processMessage(uid, 'hi');
    await processMessage(uid, 'Carol');
    await processMessage(uid, '1');
    await processMessage(uid, '8am');
    await processMessage(uid, '10pm');
    await processMessage(uid, '1 3');
    await processMessage(uid, '1');
    await processMessage(uid, 'confirm');

    const p = profileStore.get(uid);
    expect(p!.name).toBe('Carol');
    expect(p!.timezone).toBe('America/New_York');
    expect(p!.wakeTime).toBe('08:00');
    expect(p!.sleepTime).toBe('22:00');
    expect(p!.reminderTimes).toContain('08:00');
    expect(p!.reminderTimes).toContain('18:00');
    expect(p!.tone).toBe('encouraging');
    expect(p!.onboardingComplete).toBe(true);
  });
});
