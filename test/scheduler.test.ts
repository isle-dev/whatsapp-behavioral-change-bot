// Mock all modules with side effects before importing the scheduler
jest.mock('../src/modules/db',      () => ({ query: async () => null, getPool: () => null }));
jest.mock('../src/modules/profile', () => ({ get: () => null, upsert: () => null }));
jest.mock('../src/modules/monitor', () => ({ getSummary: () => ({ takenDoses: 0, missedDoses: 0, currentStreak: 0, recentBarriers: [] }) }));
jest.mock('../src/services/decider', () => ({ decide: async () => ({ send: false, reason_codes: ['test'] }) }));

import { isQuietHour, isWithinWindow } from '../src/modules/scheduler';

// ─── isQuietHour ──────────────────────────────────────────────────────────────

describe('isQuietHour', () => {
  function makeDate(hh: number, mm: number): Date {
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  describe('overnight window (22:00 – 07:00)', () => {
    const start = '22:00';
    const end   = '07:00';

    test('is quiet at 23:00', () => {
      expect(isQuietHour(start, end, undefined, makeDate(23, 0))).toBe(true);
    });

    test('is quiet at 00:00 (midnight)', () => {
      expect(isQuietHour(start, end, undefined, makeDate(0, 0))).toBe(true);
    });

    test('is quiet at 06:59', () => {
      expect(isQuietHour(start, end, undefined, makeDate(6, 59))).toBe(true);
    });

    test('is not quiet at 07:00 (boundary — exclusive end)', () => {
      expect(isQuietHour(start, end, undefined, makeDate(7, 0))).toBe(false);
    });

    test('is not quiet at 12:00', () => {
      expect(isQuietHour(start, end, undefined, makeDate(12, 0))).toBe(false);
    });

    test('is not quiet at 21:59', () => {
      expect(isQuietHour(start, end, undefined, makeDate(21, 59))).toBe(false);
    });

    test('is quiet at 22:00 (boundary — inclusive start)', () => {
      expect(isQuietHour(start, end, undefined, makeDate(22, 0))).toBe(true);
    });
  });

  describe('same-day window (13:00 – 14:00)', () => {
    const start = '13:00';
    const end   = '14:00';

    test('is quiet at 13:30', () => {
      expect(isQuietHour(start, end, undefined, makeDate(13, 30))).toBe(true);
    });

    test('is not quiet at 12:59', () => {
      expect(isQuietHour(start, end, undefined, makeDate(12, 59))).toBe(false);
    });

    test('is not quiet at 14:00 (exclusive end)', () => {
      expect(isQuietHour(start, end, undefined, makeDate(14, 0))).toBe(false);
    });
  });

  describe('defaults (21:00 – 08:00)', () => {
    test('uses default window when no args provided', () => {
      expect(isQuietHour(undefined, undefined, undefined, makeDate(21, 30))).toBe(true);
      expect(isQuietHour(undefined, undefined, undefined, makeDate(10, 0))).toBe(false);
    });
  });
});

// ─── isWithinWindow ───────────────────────────────────────────────────────────

describe('isWithinWindow', () => {
  function makeDate(hh: number, mm: number): Date {
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  test('exact match is within window', () => {
    expect(isWithinWindow('08:00', undefined, 10, makeDate(8, 0))).toBe(true);
  });

  test('10 minutes before is within window', () => {
    expect(isWithinWindow('08:00', undefined, 10, makeDate(7, 50))).toBe(true);
  });

  test('10 minutes after is within window', () => {
    expect(isWithinWindow('08:00', undefined, 10, makeDate(8, 10))).toBe(true);
  });

  test('11 minutes after is outside window', () => {
    expect(isWithinWindow('08:00', undefined, 10, makeDate(8, 11))).toBe(false);
  });

  test('11 minutes before is outside window', () => {
    expect(isWithinWindow('08:00', undefined, 10, makeDate(7, 49))).toBe(false);
  });

  test('midnight wrap: 23:55 is within window for 00:00', () => {
    expect(isWithinWindow('00:00', undefined, 10, makeDate(23, 55))).toBe(true);
  });

  test('midnight wrap: 00:05 is within window for 00:00', () => {
    expect(isWithinWindow('00:00', undefined, 10, makeDate(0, 5))).toBe(true);
  });

  test('custom window size is respected', () => {
    expect(isWithinWindow('12:00', undefined, 5, makeDate(12, 4))).toBe(true);
    expect(isWithinWindow('12:00', undefined, 5, makeDate(12, 6))).toBe(false);
  });
});
