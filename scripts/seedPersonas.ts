/**
 * scripts/seedPersonas.ts
 *
 * Seeds all 5 WHO-framework demo personas into data/profiles.json and
 * optionally plants synthetic adherence histories so the demo shows
 * realistic trend messages.
 *
 * Usage:
 *   pnpm tsx scripts/seedPersonas.ts
 *   pnpm tsx scripts/seedPersonas.ts --clear   # wipe existing data first
 *
 * Each persona maps to one of the 5 archetypes defined in Persona Draft.docx,
 * covering the 12 WHO Multidimensional Adherence Model axes.
 */
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

// ─── Path setup (mirrors profile.ts) ─────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../data');
const PROFILES  = path.join(DATA_DIR, 'profiles.json');
const ADHERENCE = path.join(DATA_DIR, 'adherence.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Persona definitions ──────────────────────────────────────────────────────

/**
 * Mapping of clinical profile axes → Profile fields.
 *
 * Axis                  | Jane  | Robert | James | Gia    | Amira
 * Routine stability     | Low   | High   | High  | Low    | Low
 * Health literacy       | High  | Mid    | Low   | High   | High
 * Access barriers       | Low   | Low    | High  | Mid    | Low
 * Social support        | Low   | Low    | Low   | Mid-Hi | Mid
 * Dosing complexity     | Mid   | Mid    | High  | Low    | Low
 * Side-effect burden    | Low   | Mid    | Mid-H | Low    | Low
 * Stress                | Mid   | Low-M  | Mid-H | High   | High
 * Perceived severity    | Mid-H | Low    | High  | Mid    | Mid
 * Motivation            | High  | Low    | Mid   | High   | Mid
 * Medication beliefs    | High  | Low    | Mid   | High   | High
 * Self-efficacy         | High  | High   | Low   | Mid    | Mid
 * Refill difficulty     | Low   | Low    | High  | Mid    | Mid
 */

const PERSONAS = [
  {
    userId: 'demo_jane',
    name: 'Jane',
    // Persona: Busy ICU nurse, rotating shifts, high knowledge, low routine
    timezone: 'America/Chicago',
    tone: 'encouraging' as const,
    reminderTimes: ['08:00', '20:00'],
    quietStart: '23:00',
    quietEnd: '06:00',
    wakeTime: '07:00',
    sleepTime: '23:00',
    // JITAI Block 1
    medTiming: 'varies' as const,
    checkinFrequency: 'daily' as const,
    // Block 2 — weekday routine
    weekdayRoutine: 'Start shift at 7am or 7pm depending on the week. Meals are unpredictable.',
    medAnchor: 'nothing',          // can't rely on meal anchors
    storageLocation: 'carry',      // keeps pills in work bag
    memoryAids: 'alarm',
    // Block 3 — weekend & schedule
    weekendRoutineDiff: 'Completely different — sometimes sleeping till noon after night shifts.',
    scheduleType: 'irregular',
    // Block 4 — recent adherence
    yesterdayAdherence: false,
    yesterdayBarrier: 'Forgot during a 14-hour shift, came home exhausted.',
    // Block 5 — barriers & social
    generalBarriers: 'Shift changes, fatigue, switching bags, muted all phone alarms at work.',
    socialSupport: 'no' as const,
    // Block 6 — beliefs & knowledge
    necessityBelief: 'important' as const,
    concernsBelief: 'not_really' as const,
    illnessUnderstanding: 'knew' as const,
    // Adherence profile for seeding history
    _adherenceProfile: { rate: 0.65, streak: 0 },
  },
  {
    userId: 'demo_robert',
    name: 'Robert',
    // Persona: Skeptical retired truck driver, 12-year HTN, intentional non-adherence
    timezone: 'America/Denver',
    tone: 'empathetic' as const,
    reminderTimes: ['09:00', '14:00'],
    quietStart: '21:00',
    quietEnd: '08:00',
    wakeTime: '08:00',
    sleepTime: '22:00',
    medTiming: 'morning' as const,
    checkinFrequency: 'once_week' as const,
    weekdayRoutine: 'Morning coffee, daily walk, lunch, TV in evenings.',
    medAnchor: 'coffee',
    storageLocation: 'kitchen',
    memoryAids: 'nothing',
    weekendRoutineDiff: 'Same routine, no real difference.',
    scheduleType: 'consistent',
    yesterdayAdherence: false,
    yesterdayBarrier: "Didn't see why I needed it — felt perfectly fine yesterday.",
    generalBarriers: 'Doubts about needing medication. Worried about kidney damage. Feels like giving in.',
    socialSupport: 'no' as const,
    necessityBelief: 'some_doubts' as const,
    concernsBelief: 'quite_a_bit' as const,
    illnessUnderstanding: 'heard' as const,
    _adherenceProfile: { rate: 0.40, streak: 0 },
  },
  {
    userId: 'demo_james',
    name: 'James',
    // Persona: Low-income elderly, multiple comorbidities, high complexity, low literacy
    timezone: 'America/New_York',
    tone: 'empathetic' as const,
    reminderTimes: ['08:30', '20:30'],
    quietStart: '21:00',
    quietEnd: '07:00',
    wakeTime: '07:30',
    sleepTime: '21:00',
    medTiming: 'morning' as const,
    checkinFrequency: 'daily' as const,
    weekdayRoutine: 'Wake up, breakfast, short walk if weather permits, TV most of the day.',
    medAnchor: 'breakfast',
    storageLocation: 'kitchen',
    memoryAids: 'organizer',
    weekendRoutineDiff: 'Basically the same every day.',
    scheduleType: 'consistent',
    yesterdayAdherence: false,
    yesterdayBarrier: 'Ran out of one medication and the pharmacy is 40 minutes away.',
    generalBarriers: 'Cost of medications, confusing pill packaging, dizziness side effects, transportation to pharmacy.',
    socialSupport: 'no' as const,
    necessityBelief: 'important' as const,
    concernsBelief: 'a_little' as const,
    illnessUnderstanding: 'heard' as const,
    _adherenceProfile: { rate: 0.55, streak: 1 },
  },
  {
    userId: 'demo_gia',
    name: 'Gia',
    // Persona: Stressed caregiver, high knowledge, overwhelmed by family demands
    timezone: 'America/Los_Angeles',
    tone: 'empathetic' as const,
    reminderTimes: ['07:00', '19:00'],
    quietStart: '22:00',
    quietEnd: '06:00',
    wakeTime: '06:00',
    sleepTime: '22:00',
    medTiming: 'evening' as const,
    checkinFrequency: 'daily' as const,
    weekdayRoutine: 'Up at 6, prepare parents\' meds, drop off granddaughter, teach morning classes.',
    medAnchor: 'dinner',
    storageLocation: 'kitchen',
    memoryAids: 'person',
    weekendRoutineDiff: 'Less structured — family commitments all day.',
    scheduleType: 'varies',
    yesterdayAdherence: false,
    yesterdayBarrier: 'Dad had a fall, forgot my own pills while taking him to urgent care.',
    generalBarriers: 'Puts family first, cognitive overload, dinner time shifts with family needs.',
    socialSupport: 'want_but_dont' as const,
    necessityBelief: 'important' as const,
    concernsBelief: 'not_really' as const,
    illnessUnderstanding: 'knew' as const,
    _adherenceProfile: { rate: 0.72, streak: 2 },
  },
  {
    userId: 'demo_amira',
    name: 'Amira',
    // Persona: Traveling consultant, newly diagnosed, tech-savvy, high stress
    timezone: 'America/New_York',
    tone: 'encouraging' as const,
    reminderTimes: ['07:30', '21:00'],
    quietStart: '23:00',
    quietEnd: '07:00',
    wakeTime: '07:00',
    sleepTime: '23:00',
    medTiming: 'morning' as const,
    checkinFrequency: 'daily' as const,
    weekdayRoutine: 'Early flight Mon, client meetings, hotel gym when I can. All over the place.',
    medAnchor: 'nothing',
    storageLocation: 'carry',
    memoryAids: 'alarm',
    weekendRoutineDiff: 'Usually traveling back home; still irregular.',
    scheduleType: 'irregular',
    yesterdayAdherence: false,
    yesterdayBarrier: 'Time zone change confused my alarm — woke up at what my body thought was 3am.',
    generalBarriers: 'Time zone changes, override reminders during meetings, carries extra pills but forgets in rush.',
    socialSupport: 'want_but_dont' as const,
    necessityBelief: 'some_doubts' as const,
    concernsBelief: 'not_really' as const,
    illnessUnderstanding: 'knew' as const,
    _adherenceProfile: { rate: 0.60, streak: 3 },
  },
];

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function buildProfile(p: typeof PERSONAS[number]) {
  const { _adherenceProfile: _, ...rest } = p;
  return {
    ...rest,
    onboardingComplete: true,
    onboardingStep: 'DONE' as const,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks ago
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Generate 14 days of synthetic adherence events for a persona.
 * Event timestamps are spread across the past 14 days at realistic times.
 */
function generateAdherenceHistory(userId: string, rate: number, streak: number) {
  const events: Array<{
    userId: string; timestamp: string; taken: boolean;
    barrier?: string; source: string; com_b_barrier?: string;
  }> = [];

  const barriers: Record<string, string[]> = {
    demo_jane:   ['Forgot during shift', 'Muted all alarms at work', 'Switched bags, pills stayed home'],
    demo_robert: ["Felt fine — didn't see the point", "Doubts about long-term harm", "Just forgot to"],
    demo_james:  ['Ran out of pills', 'Dizziness made me hesitant', 'Pharmacy run delayed'],
    demo_gia:    ['Family crisis, forgot my own meds', 'Dinner time shifted too late', 'Ran out'],
    demo_amira:  ['Time zone alarm confusion', 'Client meeting overran', 'Forgot in hotel checkout rush'],
  };

  const com_b: Record<string, string[]> = {
    demo_jane:   ['Capability', 'Opportunity', 'Opportunity'],
    demo_robert: ['Motivation', 'Motivation', 'Capability'],
    demo_james:  ['Opportunity', 'Capability', 'Opportunity'],
    demo_gia:    ['Opportunity', 'Opportunity', 'Opportunity'],
    demo_amira:  ['Capability', 'Opportunity', 'Capability'],
  };

  const personaBarriers = barriers[userId] ?? ['Forgot'];
  const personaComB     = com_b[userId]     ?? ['Motivation'];

  let barrierIdx = 0;
  const now = Date.now();

  // Seed the streak days first (all taken, working backward from yesterday)
  for (let i = 1; i <= streak; i++) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    d.setHours(8, Math.floor(Math.random() * 30), 0);
    events.push({ userId, timestamp: d.toISOString(), taken: true, source: 'self_report' });
  }

  // Seed the remaining 14 – streak days
  for (let i = streak + 1; i <= 14; i++) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    d.setHours(8, Math.floor(Math.random() * 30), 0);
    const taken = Math.random() < rate;
    const event: typeof events[number] = { userId, timestamp: d.toISOString(), taken, source: 'self_report' };
    if (!taken) {
      event.barrier    = personaBarriers[barrierIdx % personaBarriers.length];
      event.com_b_barrier = personaComB[barrierIdx % personaComB.length];
      barrierIdx++;
    }
    events.push(event);
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const clear = process.argv.includes('--clear');
  ensureDataDir();

  // Profiles
  const existingProfiles = (!clear && fs.existsSync(PROFILES))
    ? JSON.parse(fs.readFileSync(PROFILES, 'utf8'))
    : {};

  for (const persona of PERSONAS) {
    existingProfiles[persona.userId] = buildProfile(persona);
    console.log(`✅  Profile seeded: ${persona.userId} (${persona.name})`);
  }
  fs.writeFileSync(PROFILES, JSON.stringify(existingProfiles, null, 2));

  // Adherence history
  const existingAdherence = (!clear && fs.existsSync(ADHERENCE))
    ? JSON.parse(fs.readFileSync(ADHERENCE, 'utf8'))
    : {};

  for (const persona of PERSONAS) {
    const { rate, streak } = persona._adherenceProfile;
    existingAdherence[persona.userId] = generateAdherenceHistory(persona.userId, rate, streak);
    console.log(
      `📊  Adherence history seeded: ${persona.userId} ` +
      `(~${Math.round(rate * 100)}% rate, ${streak}-day streak)`
    );
  }
  fs.writeFileSync(ADHERENCE, JSON.stringify(existingAdherence, null, 2));

  console.log('\n🎉  All 5 demo personas ready. Run `pnpm tsx scripts/demoConversation.ts` to simulate.');
  console.log('\nPersona IDs:');
  for (const p of PERSONAS) {
    console.log(`  ${p.userId.padEnd(14)} → ${p.name} (tone: ${p.tone}, tz: ${p.timezone})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
