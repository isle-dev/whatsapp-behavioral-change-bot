/**
 * scripts/demoConversation.ts
 *
 * Simulates a full Medi conversation WITHOUT needing WhatsApp.
 * Runs in the terminal — perfect for poster demos, screen recordings, and
 * showing reviewers exactly what the patient experience looks like.
 *
 * Usage:
 *   pnpm tsx scripts/demoConversation.ts                 # interactive (pick persona & scenario)
 *   pnpm tsx scripts/demoConversation.ts --persona jane  # jump straight to Jane
 *   pnpm tsx scripts/demoConversation.ts --all           # run all 5 personas back-to-back
 *   pnpm tsx scripts/demoConversation.ts --onboarding    # show full onboarding flow
 *
 * The script prints a colour-coded chat transcript that mirrors the WhatsApp
 * message bubbles described in the poster figures.
 */
import path from 'path';
import readline from 'readline';
import 'dotenv/config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const BLUE   = '\x1b[34m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const GREY   = '\x1b[90m';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function printBot(text: string) {
  const lines = text.split('\n');
  console.log(`\n${BLUE}${BOLD}🤖 Medi${RESET}`);
  for (const line of lines) {
    const l = line
      .replace(/\*(.*?)\*/g, `${BOLD}$1${RESET}`)
      .replace(/_(.*?)_/g, `${DIM}$1${RESET}`);
    console.log(`  ${l}`);
  }
}

function printUser(name: string, text: string) {
  console.log(`\n${GREEN}${BOLD}👤 ${name}${RESET}`);
  console.log(`  ${text}`);
}

function printSection(title: string) {
  console.log(`\n${YELLOW}${'─'.repeat(60)}${RESET}`);
  console.log(`${YELLOW}${BOLD}  ${title}${RESET}`);
  console.log(`${YELLOW}${'─'.repeat(60)}${RESET}`);
}

function printMeta(text: string) {
  console.log(`${GREY}${DIM}  [${text}]${RESET}`);
}

// ─── Import bot logic ─────────────────────────────────────────────────────────

// We import after dotenv so env vars are loaded
async function getProcessInbound() {
  const mod = await import('../src/modules/orchestration');
  return mod.processInbound;
}

async function getMonitor() {
  const mod = await import('../src/modules/monitor');
  return mod;
}

async function getScheduler() {
  const mod = await import('../src/modules/scheduler');
  return mod;
}

async function getProfileStore() {
  const mod = await import('../src/modules/profile');
  return mod;
}

// ─── Scripted conversation scenarios ─────────────────────────────────────────

interface Message { from: 'user' | 'bot'; text: string; delayMs?: number; meta?: string; }

/**
 * Jane — shift nurse. Demonstrates: missed dose, barrier logging, COM-B Opportunity,
 * tone adaptation, reminder with anchor hint.
 */
function janeScript(): Message[] {
  return [
    { from: 'meta', text: 'Persona: Jane — ICU nurse, rotating shifts, high knowledge, Opportunity barrier' } as any,
    { from: 'bot',  text: 'Hey Jane! 💊 Time for your medication.\n\n📊 You\'re on a 0-day streak — this week was tough. Every dose counts. Let\'s try again today!\n\nReply *Y* when you\'ve taken it!', meta: 'Morning reminder (08:00)' },
    { from: 'user', text: 'N', meta: 'Missed dose' },
    { from: 'bot',  text: 'Got it. I\'ve noted this dose as missed. You\'ll get a reminder next time. 💙' },
    { from: 'user', text: 'Was switching from night shift to day shift, pills were in my other bag' },
    { from: 'bot',  text: 'That makes sense — shift switches are really tough for building any routine. A few people find it helps to keep a small backup supply in their locker or work area, so one bag switch doesn\'t mean a missed dose.\n\nNo pressure to change everything at once. Even small tweaks help. 💙\n\nWant me to remind you again this evening?' },
    { from: 'user', text: 'Yes please, around 8pm' },
    { from: 'bot',  text: '✅ Reminder times updated to *20:00*.' },
    { from: 'meta', text: '— Evening, 20:00 —' } as any,
    { from: 'bot',  text: 'Evening Jane! 💊 Time for your medication.\n\n💡 Tip: Keep a backup dose in your scrub pocket.\n\nReply *Y* when you\'ve taken it!', meta: 'Evening reminder (20:00)' },
    { from: 'user', text: 'Y' },
    { from: 'bot',  text: '✅ Dose logged as taken. Keep it up!' },
  ];
}

/**
 * Robert — skeptical retiree. Demonstrates: motivation barrier, belief reframing,
 * empathetic tone, illness understanding gap.
 */
function robertScript(): Message[] {
  return [
    { from: 'meta', text: 'Persona: Robert — skeptical retiree, 12-yr HTN, Motivation barrier (belief-based)' } as any,
    { from: 'bot',  text: 'Hi Robert — just a gentle reminder to take your medication. 💙\n\nReply *Y* taken / *N* missed.', meta: 'Morning reminder (09:00)' },
    { from: 'user', text: 'N' },
    { from: 'bot',  text: "Got it. I've noted this dose as missed. You'll get a reminder next time. 💙" },
    { from: 'user', text: "I just don't feel sick. My blood pressure feels fine." },
    { from: 'bot',  text: "That's one of the tricky things about hypertension — it usually has no symptoms, so it's hard to feel that it's there. But that 'silent pressure' is still doing work on your heart and blood vessels behind the scenes.\n\nYou're not taking this because you feel sick. You're taking it to stay feeling this good. That's a real distinction.\n\nNo lecture intended — just wanted to share that. What's been your biggest hesitation lately?" },
    { from: 'user', text: "I worry the medication will damage my kidneys long term" },
    { from: 'bot',  text: "That's worth asking your doctor about directly — they can run a simple kidney function test to put your mind at ease. That's a really reasonable concern and your doctor can speak to your specific medication.\n\nWhat I do know is that uncontrolled high blood pressure is one of the leading causes of kidney damage, so the medication is typically protecting kidneys, not harming them. But your doctor knows your case best.\n\nWould it help to have a reminder before your next appointment?" },
  ];
}

/**
 * Gia — stressed caregiver. Demonstrates: high adherence rate, contextual empathy,
 * Opportunity barrier (family demands).
 */
function giaScript(): Message[] {
  return [
    { from: 'meta', text: 'Persona: Gia — caregiver, 72% adherence, 2-day streak, Opportunity barrier' } as any,
    { from: 'bot',  text: 'Hi Gia — just a gentle reminder to take your medication. 💙\n\nYou\'ve been so consistent — 2 days in a row. That takes real effort. 💙\n\nNo pressure — just reply *Y* when you\'re ready.', meta: 'Evening reminder (19:00)' },
    { from: 'user', text: 'Not yet — dad had an episode today and I\'ve been at the hospital all afternoon' },
    { from: 'bot',  text: "Oh, that sounds like such an exhausting and stressful day. I hope your dad is okay. 💙\n\nWhen things settle — even just for a moment tonight — try to get your medication in. It's easy to forget yourself when you're caring for everyone else, but your health matters too.\n\nNo pressure right now. I'll check in with you tomorrow morning." },
    { from: 'user', text: 'Y — took it before bed. Thanks for checking in.' },
    { from: 'bot',  text: '✅ Dose logged as taken. Keep it up!\n\nYou took care of your dad and yourself today. That matters. 💙' },
  ];
}

/**
 * Amira — traveling consultant. Demonstrates: time-zone-aware scheduling,
 * tech-friendly approach, Capability barrier (alarm confusion).
 */
function amiraScript(): Message[] {
  return [
    { from: 'meta', text: 'Persona: Amira — consultant, frequent travel, Capability barrier (timezone confusion)' } as any,
    { from: 'bot',  text: 'Hey Amira! 💊 Time for your medication.\n\n📊 You\'re on a 3-day streak! Keep going!\n\nReply *Y* when you\'ve taken it!', meta: 'Morning reminder (07:30 ET)' },
    { from: 'user', text: "I'm actually in Pacific time this week — in San Francisco for a client" },
    { from: 'bot',  text: '✅ Timezone updated to *America/Los_Angeles*.' },
    { from: 'user', text: 'Y' },
    { from: 'bot',  text: '✅ Dose logged as taken. Keep it up!\n\nAnd your reminders are now set to Pacific time for the week.' },
  ];
}

/**
 * James — elderly, low-income. Demonstrates: access barrier, simple empathetic message,
 * clear actionable instructions.
 */
function jamesScript(): Message[] {
  return [
    { from: 'meta', text: 'Persona: James — elderly, fixed income, high complexity, access barriers' } as any,
    { from: 'bot',  text: 'Hi James — just a gentle reminder to take your medication. 💙\n\nYour medication is in the kitchen.\n\nNo pressure — just reply *Y* when you\'re ready.', meta: 'Morning reminder (08:30)' },
    { from: 'user', text: 'Ran out of my water pill. Pharmacy is far.' },
    { from: 'bot',  text: "Running out is really frustrating, especially when the pharmacy is a long trip. A couple of options worth exploring:\n\n• Many pharmacies offer home delivery — CVS, Walgreens, and others often do this for free.\n• Your doctor may be able to call in a 90-day supply so you need fewer trips.\n\nIn the meantime, take the medications you do have. Let me know when you're back on track. 💙" },
    { from: 'user', text: 'ok thank you' },
    { from: 'bot',  text: "Of course. Take care James — and reach out anytime. 💙" },
  ];
}

// ─── Onboarding scenario (first-time user) ────────────────────────────────────

async function runOnboardingDemo() {
  const processInbound = await getProcessInbound();

  printSection('SCENARIO: First-time Onboarding (New Patient)');
  printMeta('userId: demo_new_patient_onboarding');
  await sleep(400);

  const userId = `demo_onboarding_${Date.now()}`;

  // Script: answer onboarding questions for a new user named "Maria"
  const steps: [string, string][] = [
    ['Welcome → Name', 'Maria'],
    ['Timezone',       'Eastern'],
    ['Med timing',     'morning'],
    ['Checkin freq',   'daily'],
    ['Weekday routine','I have coffee and read the news at 7am before work.'],
    ['Med anchor',     'coffee'],
    ['Storage',        'kitchen'],
    ['Memory aids',    'alarm'],
    ['Weekend routine','Pretty similar but I wake up around 8.'],
    ['Schedule type',  'consistent'],
    ['Yesterday taken?','Y'],
    ['General barriers','Sometimes I forget on days I skip breakfast.'],
    ['Social support', 'yes'],
    ['Necessity belief','important'],
    ['Concerns belief', 'not_really'],
    ['Illness understanding','heard'],
    ['Tone preference', 'encouraging'],
    ['Confirm',        'save'],
  ];

  for (const [label, userMsg] of steps) {
    await sleep(300);
    const result = await processInbound(userId, userMsg);
    for (const msg of result.messages) {
      printBot(msg);
    }
    printMeta(`Step: ${label}`);
    await sleep(200);
    if (userMsg) {
      printUser('Maria (new patient)', userMsg);
    }
  }
}

// ─── Scripted scenario runner ─────────────────────────────────────────────────

async function runScript(name: string, messages: Message[]) {
  const processInbound = await getProcessInbound();
  const monitor = await getMonitor();

  const personaId = `demo_${name.toLowerCase()}`;
  printSection(`PERSONA: ${name}`);

  for (const msg of messages) {
    await sleep(350);

    if ((msg as any).from === 'meta') {
      printMeta((msg as any).text);
      continue;
    }

    if (msg.from === 'bot') {
      printBot(msg.text);
      if (msg.meta) printMeta(msg.meta);
      continue;
    }

    // User message → run through the bot engine
    printUser(name, msg.text);
    if (msg.meta) printMeta(msg.meta);

    const text = msg.text.trim();
    const lower = text.toLowerCase();

    // Log Y/N to monitor
    if (lower === 'y' || lower === 'yes') {
      monitor.logDose(personaId, true, { source: 'self_report' });
    } else if (lower === 'n' || lower === 'no') {
      monitor.logDose(personaId, false, { source: 'self_report' });
    }

    try {
      const result = await processInbound(personaId, text);
      for (const m of result.messages) {
        await sleep(200);
        printBot(m);
      }
    } catch (err) {
      printBot(`[bot error: ${(err as Error).message}]`);
    }
  }
}

// ─── Adherence summary printer ────────────────────────────────────────────────

async function printAdherenceSummaries() {
  const monitor = await getMonitor();
  const personas = ['demo_jane', 'demo_robert', 'demo_james', 'demo_gia', 'demo_amira'];
  const names    = ['Jane',      'Robert',      'James',      'Gia',      'Amira'     ];

  printSection('ADHERENCE SUMMARIES (last 14 days)');

  for (let i = 0; i < personas.length; i++) {
    const s = monitor.getSummary(personas[i], 14);
    const bar = '█'.repeat(Math.round(s.adherenceRate * 10)) + '░'.repeat(10 - Math.round(s.adherenceRate * 10));
    console.log(
      `  ${BOLD}${names[i].padEnd(8)}${RESET}  ` +
      `${CYAN}${bar}${RESET}  ` +
      `${BOLD}${Math.round(s.adherenceRate * 100)}%${RESET}  ` +
      `streak: ${s.currentStreak}d  ` +
      `${GREY}(${s.takenDoses}/${s.totalDoses} doses)${RESET}`
    );
  }
}

// ─── Scheduler dry-run ────────────────────────────────────────────────────────

async function printSchedulerDryRun() {
  const scheduler = await getScheduler();
  printSection('SCHEDULER — due routines right now');

  const due = await scheduler.getDueRoutines();
  if (due.length === 0) {
    console.log(`  ${DIM}No reminders are due at this moment (check quiet hours or reminder times).${RESET}`);
  } else {
    for (const d of due) {
      const msg = scheduler.buildReminderMessage(d.profile);
      console.log(`\n  ${BOLD}→ ${d.userId}${RESET}  (scheduled: ${d.scheduledTime})`);
      console.log(`  ${DIM}${msg.split('\n')[0]}...${RESET}`);
    }
  }
}

// ─── Interactive menu ─────────────────────────────────────────────────────────

async function interactiveMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗`);
  console.log(`║     Medi — Demo Conversation Runner      ║`);
  console.log(`╚══════════════════════════════════════════╝${RESET}\n`);

  console.log('What would you like to run?\n');
  console.log('  1. Jane    — Shift nurse (Opportunity barrier)');
  console.log('  2. Robert  — Skeptical retiree (Motivation barrier)');
  console.log('  3. Gia     — Stressed caregiver (Opportunity barrier)');
  console.log('  4. Amira   — Traveling consultant (Capability barrier)');
  console.log('  5. James   — Elderly, access barriers (Opportunity barrier)');
  console.log('  6. Onboarding — New patient first contact');
  console.log('  7. All personas + adherence summaries');
  console.log('  0. Exit\n');

  const choice = await ask('Enter choice: ');
  rl.close();

  switch (choice.trim()) {
    case '1': await runScript('Jane',   janeScript()); break;
    case '2': await runScript('Robert', robertScript()); break;
    case '3': await runScript('Gia',    giaScript()); break;
    case '4': await runScript('Amira',  amiraScript()); break;
    case '5': await runScript('James',  jamesScript()); break;
    case '6': await runOnboardingDemo(); break;
    case '7':
      for (const [name, script] of [
        ['Jane',   janeScript()],
        ['Robert', robertScript()],
        ['Gia',    giaScript()],
        ['Amira',  amiraScript()],
        ['James',  jamesScript()],
      ] as [string, Message[]][]) {
        await runScript(name, script);
        await sleep(500);
      }
      await printAdherenceSummaries();
      await printSchedulerDryRun();
      break;
    case '0': process.exit(0); break;
    default: console.log('Unknown choice, exiting.'); process.exit(1);
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--all')) {
    for (const [name, script] of [
      ['Jane',   janeScript()],
      ['Robert', robertScript()],
      ['Gia',    giaScript()],
      ['Amira',  amiraScript()],
      ['James',  jamesScript()],
    ] as [string, Message[]][]) {
      await runScript(name, script);
      await sleep(300);
    }
    await printAdherenceSummaries();
    await printSchedulerDryRun();
    return;
  }

  if (args.includes('--onboarding')) {
    await runOnboardingDemo();
    return;
  }

  const personaArg = args.find((a) => a.startsWith('--persona='))?.split('=')[1]
    ?? (args.includes('--persona') ? args[args.indexOf('--persona') + 1] : null);

  if (personaArg) {
    const map: Record<string, () => Message[]> = {
      jane: janeScript, robert: robertScript, gia: giaScript,
      amira: amiraScript, james: jamesScript,
    };
    const fn = map[personaArg.toLowerCase()];
    if (!fn) { console.error(`Unknown persona: ${personaArg}`); process.exit(1); }
    await runScript(personaArg.charAt(0).toUpperCase() + personaArg.slice(1), fn());
    return;
  }

  // Default: interactive menu
  await interactiveMenu();
}

main().catch((e) => { console.error(e); process.exit(1); });
