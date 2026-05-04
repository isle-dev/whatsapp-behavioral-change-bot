import 'dotenv/config';

// ─── Isolate file system ──────────────────────────────────────────────────────

const fakeStore: Record<string, unknown[]> = {};

jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    existsSync: (p: string) => p.endsWith('adherence.json') ? true : real.existsSync(p),
    mkdirSync: () => undefined,
    readFileSync: (p: string, enc: unknown) =>
      p.endsWith('adherence.json') ? JSON.stringify(fakeStore) : real.readFileSync(p, enc as never),
    writeFileSync: (_p: string, data: string) => {
      const parsed = JSON.parse(data) as typeof fakeStore;
      Object.keys(fakeStore).forEach((k) => delete fakeStore[k]);
      Object.assign(fakeStore, parsed);
    },
  };
});

import { classifyBarrier, logDose, amendLastBarrier, getSummary } from '../src/modules/monitor';

beforeEach(() => {
  Object.keys(fakeStore).forEach((k) => delete fakeStore[k]);
});

// ─── classifyBarrier ──────────────────────────────────────────────────────────

describe('classifyBarrier', () => {
  test.each([
    ['I forgot',                         'Capability'],
    ['felt confused about the dose',     'Capability'],
    ['had a side effect — nausea',       'Capability'],
    ['was too tired to get up',          'Capability'],
    ['ran out of pills',                 'Opportunity'],
    ['pharmacy was closed',              'Opportunity'],
    ['was travelling for work',          'Opportunity'],
    ['too busy at work today',           'Opportunity'],
    ['didn\'t think it mattered',        'Motivation'],
    ['feel fine without it',             'Motivation'],
    ['no reason really',                 'Motivation'],
    ['not sure why',                     'Motivation'],
  ])('classifyBarrier(%s) → %s', (input, expected) => {
    expect(classifyBarrier(input)).toBe(expected);
  });

  test('unknown input defaults to Motivation', () => {
    expect(classifyBarrier('something completely unrelated xyz')).toBe('Motivation');
  });
});

// ─── amendLastBarrier ─────────────────────────────────────────────────────────

describe('amendLastBarrier', () => {
  test('patches the most recent missed event with barrier text and COM-B tag', () => {
    logDose('u1', false, { source: 'self_report' });
    amendLastBarrier('u1', 'I forgot');
    const summary = getSummary('u1');
    expect(summary.recentBarriers).toContain('I forgot');
  });

  test('does not patch taken events', () => {
    logDose('u2', true,  { source: 'self_report' });
    logDose('u2', false, { source: 'self_report' });
    logDose('u2', true,  { source: 'self_report' });
    amendLastBarrier('u2', 'ran out');
    const summary = getSummary('u2');
    expect(summary.recentBarriers).toContain('ran out');
  });

  test('does not overwrite a barrier already set', () => {
    logDose('u3', false, { source: 'self_report', barrier: 'original' });
    amendLastBarrier('u3', 'should not overwrite');
    const summary = getSummary('u3');
    expect(summary.recentBarriers).toContain('original');
    expect(summary.recentBarriers).not.toContain('should not overwrite');
  });

  test('no-op when user has no events', () => {
    expect(() => amendLastBarrier('u-unknown', 'anything')).not.toThrow();
  });
});

// ─── getSummary ───────────────────────────────────────────────────────────────

describe('getSummary', () => {
  // Streak logic sorts by timestamp, so events need distinct times.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  function tick() { jest.advanceTimersByTime(60_000); }

  test('empty history returns zero rates', () => {
    const s = getSummary('empty-user');
    expect(s.totalDoses).toBe(0);
    expect(s.adherenceRate).toBe(0);
    expect(s.currentStreak).toBe(0);
  });

  test('all taken produces 100% adherence and correct streak', () => {
    logDose('s1', true, { source: 'self_report' }); tick();
    logDose('s1', true, { source: 'self_report' }); tick();
    logDose('s1', true, { source: 'self_report' });
    const s = getSummary('s1');
    expect(s.adherenceRate).toBe(1);
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
  });

  test('streak breaks on missed dose', () => {
    logDose('s2', true,  { source: 'self_report' }); tick();
    logDose('s2', true,  { source: 'self_report' }); tick();
    logDose('s2', false, { source: 'self_report' }); tick();
    logDose('s2', true,  { source: 'self_report' });
    const s = getSummary('s2');
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(2);
  });

  test('adherenceRate is computed correctly', () => {
    logDose('s3', true,  { source: 'self_report' }); tick();
    logDose('s3', false, { source: 'self_report' }); tick();
    logDose('s3', true,  { source: 'self_report' }); tick();
    logDose('s3', true,  { source: 'self_report' });
    const s = getSummary('s3');
    expect(s.adherenceRate).toBeCloseTo(0.75);
  });
});
