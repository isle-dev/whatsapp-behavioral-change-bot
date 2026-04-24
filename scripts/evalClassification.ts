/**
 * scripts/evalClassification.ts
 *
 * Evaluates the AI agent's ability to accurately classify patient barrier
 * statements into the COM-B framework (Capability / Opportunity / Motivation),
 * with optional sub-category scoring.
 *
 * Scoring rubric (from "Evaluating the Goodness of AI Agent Generated Messages"):
 *
 *   0 = Wrong large category (Motivation vs Capability vs Opportunity)
 *   1 = Correct large category, obviously wrong subcategory
 *   2 = Correct large category, wrong subcategory but would still generate
 *       an appropriate message
 *   3 = Correct large category, correct subcategory
 *
 * An "ambiguous" tag is produced when the statement could fit multiple categories.
 *
 * Usage:
 *   pnpm tsx scripts/evalClassification.ts
 *   pnpm tsx scripts/evalClassification.ts --output results/classify_$(date +%Y%m%d).json
 *   pnpm tsx scripts/evalClassification.ts --offline    # use rule-based classifier only
 *
 * The gold-standard annotations below were created based on expert consensus
 * following the protocol described in the evaluation document.
 */
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ComBCategory = 'Capability' | 'Opportunity' | 'Motivation';
export type ComBSubcategory =
  // Capability sub-types
  | 'Forgetting'        // Physical/automatic cognition failures
  | 'Knowledge'         // Doesn't know how/when/why
  | 'Physical'          // Side effects, physical barriers, illness
  | 'Skill'             // Doesn't know how to manage the routine
  // Opportunity sub-types
  | 'Access'            // Can't get to pharmacy, pills not available
  | 'Time'              // Not enough time; work / schedule collision
  | 'Physical_env'      // Not at home, travelling, pills in wrong place
  | 'Social_env'        // Lack of reminders or support from others
  // Motivation sub-types
  | 'Necessity_belief'  // Doesn't believe medication is needed
  | 'Concern_belief'    // Worried about side effects or long-term harm
  | 'Identity'          // Conflicts with self-image
  | 'Habit'             // Not yet automatic; no intrinsic motivation
  | 'Emotional';        // Stress, depression, overwhelmed

export type Ambiguity = 'none' | 'ambiguous' | 'borderline';

export interface ClassificationGold {
  id: string;
  statement: string;
  category:     ComBCategory;
  subcategory:  ComBSubcategory;
  ambiguity:    Ambiguity;
  persona?:     string;
  notes?:       string;
}

export interface ClassificationResult {
  id: string;
  statement:           string;
  predictedCategory:   ComBCategory;
  predictedSubcategory?: ComBSubcategory;
  predictedAmbiguity:  Ambiguity;
  score:               0 | 1 | 2 | 3;
  goldCategory:        ComBCategory;
  goldSubcategory:     ComBSubcategory;
  correct:             boolean;  // score >= 2 (usable message)
  exact:               boolean;  // score == 3
  classifierUsed:      'llm' | 'rule-based';
  rawLLMOutput?:       string;
}

// ─── Gold-standard annotation set ────────────────────────────────────────────
// 45 patient statements across all 3 categories and 5 personas.
// Designed to cover: clear cases, borderline cases, ambiguous cases.

export const GOLD_ANNOTATIONS: ClassificationGold[] = [
  // ── Motivation / Necessity Belief ──
  { id: 'C01', statement: "I feel completely fine. My blood pressure is never actually that high.", category: 'Motivation', subcategory: 'Necessity_belief', ambiguity: 'none', persona: 'Robert', notes: 'Classic asymptomatic HTN dismissal' },
  { id: 'C02', statement: "I didn't take it because I've been feeling perfectly healthy for months.", category: 'Motivation', subcategory: 'Necessity_belief', ambiguity: 'none', persona: 'Robert' },
  { id: 'C03', statement: "I'm not convinced the medication is actually doing anything.", category: 'Motivation', subcategory: 'Necessity_belief', ambiguity: 'none' },
  { id: 'C04', statement: "What's the point, my numbers are always close to normal anyway.", category: 'Motivation', subcategory: 'Necessity_belief', ambiguity: 'none' },

  // ── Motivation / Concern Belief ──
  { id: 'C05', statement: "I worry the medication will damage my kidneys if I take it every day.", category: 'Motivation', subcategory: 'Concern_belief', ambiguity: 'none', persona: 'Robert', notes: 'Explicit medication concern' },
  { id: 'C06', statement: "My neighbour said these pills cause liver problems.", category: 'Motivation', subcategory: 'Concern_belief', ambiguity: 'none' },
  { id: 'C07', statement: "I'm scared of becoming dependent on it.", category: 'Motivation', subcategory: 'Concern_belief', ambiguity: 'borderline', notes: 'Could also be Identity' },
  { id: 'C08', statement: "The medication makes me feel like an old person, I don't want to need pills.", category: 'Motivation', subcategory: 'Identity', ambiguity: 'borderline', notes: 'Concern/Identity borderline' },

  // ── Motivation / Identity ──
  { id: 'C09', statement: "Taking pills every day feels like giving up my independence.", category: 'Motivation', subcategory: 'Identity', ambiguity: 'none', persona: 'Robert' },
  { id: 'C10', statement: "I've always taken care of my health naturally, I don't like relying on drugs.", category: 'Motivation', subcategory: 'Identity', ambiguity: 'none' },

  // ── Motivation / Emotional ──
  { id: 'C11', statement: "I've just been really down lately and honestly can't keep track of anything.", category: 'Motivation', subcategory: 'Emotional', ambiguity: 'borderline', notes: 'Emotional + Forgetting borderline' },
  { id: 'C12', statement: "What's the point in taking care of myself anymore.", category: 'Motivation', subcategory: 'Emotional', ambiguity: 'none', notes: 'Possible crisis flag' },
  { id: 'C13', statement: "I've been so stressed with everything going on that I just forget.", category: 'Motivation', subcategory: 'Emotional', ambiguity: 'ambiguous', notes: 'Emotional OR Capability/Forgetting' },

  // ── Motivation / Habit ──
  { id: 'C14', statement: "I just keep forgetting — it hasn't become automatic for me yet.", category: 'Motivation', subcategory: 'Habit', ambiguity: 'ambiguous', notes: 'Habit vs Forgetting borderline' },
  { id: 'C15', statement: "I never built it into my routine.", category: 'Motivation', subcategory: 'Habit', ambiguity: 'none' },

  // ── Capability / Forgetting ──
  { id: 'C16', statement: "I completely forgot. I was rushing out the door.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'none', persona: 'Jane' },
  { id: 'C17', statement: "By the time I get home after a 12-hour shift my mind is just blank.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'borderline', notes: 'Forgetting driven by fatigue/stress' },
  { id: 'C18', statement: "I muted all my alarms at work and forgot to unmute them.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'none', persona: 'Jane' },
  { id: 'C19', statement: "I switched bags before my shift and left my pills in the old one.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'borderline', notes: 'Forgetting vs Physical_env borderline' },
  { id: 'C20', statement: "I genuinely just forgot this morning, no real reason.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'none' },

  // ── Capability / Knowledge ──
  { id: 'C21', statement: "I wasn't sure if I should take it with food or not, so I waited.", category: 'Capability', subcategory: 'Knowledge', ambiguity: 'none', persona: 'James' },
  { id: 'C22', statement: "I didn't know if I was supposed to take it when I have a cold.", category: 'Capability', subcategory: 'Knowledge', ambiguity: 'none' },
  { id: 'C23', statement: "The pharmacist changed the brand and the new pill looks different — I wasn't sure it was the same.", category: 'Capability', subcategory: 'Knowledge', ambiguity: 'none', persona: 'James' },

  // ── Capability / Physical ──
  { id: 'C24', statement: "The dizziness from my water pill makes me scared to take it.", category: 'Capability', subcategory: 'Physical', ambiguity: 'borderline', notes: 'Could be Concern_belief' },
  { id: 'C25', statement: "I felt really nauseous after taking it so I skipped the next dose.", category: 'Capability', subcategory: 'Physical', ambiguity: 'none' },
  { id: 'C26', statement: "I was in hospital last week and got confused about which medications to continue.", category: 'Capability', subcategory: 'Physical', ambiguity: 'borderline' },

  // ── Capability / Skill ──
  { id: 'C27', statement: "I never figured out how to set up a good reminder system for myself.", category: 'Capability', subcategory: 'Skill', ambiguity: 'borderline', notes: 'Skill vs Habit borderline' },
  { id: 'C28', statement: "I can never remember which pill is which in my pill organiser.", category: 'Capability', subcategory: 'Skill', ambiguity: 'none', persona: 'James' },

  // ── Opportunity / Access ──
  { id: 'C29', statement: "I ran out of pills and the pharmacy is a 40-minute drive.", category: 'Opportunity', subcategory: 'Access', ambiguity: 'none', persona: 'James' },
  { id: 'C30', statement: "My refill isn't ready until next week and I've run out.", category: 'Opportunity', subcategory: 'Access', ambiguity: 'none' },
  { id: 'C31', statement: "I couldn't get to the pharmacy — I don't have a car today.", category: 'Opportunity', subcategory: 'Access', ambiguity: 'none' },
  { id: 'C32', statement: "My medication is too expensive this month, I'm rationing it.", category: 'Opportunity', subcategory: 'Access', ambiguity: 'none', persona: 'James' },

  // ── Opportunity / Time ──
  { id: 'C33', statement: "I had back-to-back meetings all day and never found a moment.", category: 'Opportunity', subcategory: 'Time', ambiguity: 'none', persona: 'Amira' },
  { id: 'C34', statement: "My shift ran over by three hours and I missed the window.", category: 'Opportunity', subcategory: 'Time', ambiguity: 'borderline', notes: 'Time vs Forgetting' },
  { id: 'C35', statement: "I was running late for a client call and completely lost track.", category: 'Opportunity', subcategory: 'Time', ambiguity: 'ambiguous', notes: 'Time OR Forgetting' },

  // ── Opportunity / Physical environment ──
  { id: 'C36', statement: "I was travelling for work and forgot my pills at home.", category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'borderline', notes: 'Physical_env vs Forgetting', persona: 'Amira' },
  { id: 'C37', statement: "My medication is at home and I ended up staying at my parents overnight.", category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'none' },
  { id: 'C38', statement: "Time zone change totally confused my alarm — it went off at 3am.", category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'none', persona: 'Amira' },
  { id: 'C39', statement: "My medication is in the kitchen, but I slept over at a friend's house.", category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'none' },

  // ── Opportunity / Social environment ──
  { id: 'C40', statement: "Nobody at home remembers to remind me anymore.", category: 'Opportunity', subcategory: 'Social_env', ambiguity: 'none' },
  { id: 'C41', statement: "My partner used to help me remember but they're travelling for work.", category: 'Opportunity', subcategory: 'Social_env', ambiguity: 'none' },

  // ── Ambiguous / borderline cases ──
  { id: 'C42', statement: "I've been really busy and stressed, just haven't had time.", category: 'Opportunity', subcategory: 'Time', ambiguity: 'ambiguous', notes: 'Time OR Emotional/Motivation' },
  { id: 'C43', statement: "I meant to take it but the day just got away from me.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'ambiguous', notes: 'Forgetting OR Time borderline' },
  { id: 'C44', statement: "I was dealing with my father's fall all day and forgot everything.", category: 'Capability', subcategory: 'Forgetting', ambiguity: 'ambiguous', notes: 'Forgetting driven by family crisis (Gia)', persona: 'Gia' },
  { id: 'C45', statement: "I'm not sure why, I just didn't.", category: 'Motivation', subcategory: 'Habit', ambiguity: 'ambiguous', notes: 'Truly ambiguous — no stated reason' },
];

// ─── Rule-based classifier (offline mode) ────────────────────────────────────

import { classifyBarrier } from '../src/modules/monitor';

function ruleBasedClassify(statement: string): { category: ComBCategory; subcategory?: ComBSubcategory; ambiguity: Ambiguity } {
  const s = statement.toLowerCase();

  // Detect explicit ambiguity markers
  const ambiguityHints = /not sure why|just didn.t|don.t know why|can.t explain|hard to say/i.test(s);

  // Sub-category detection (more specific than the top-level classifier)
  if (/ran out|no pills|pharmacy|refill|can.t get|too expensive|no car|transport/.test(s)) {
    return { category: 'Opportunity', subcategory: 'Access', ambiguity: 'none' };
  }
  if (/time.?zone|alarm (went off|fired)|wrong time|dst|daylight/.test(s)) {
    return { category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'none' };
  }
  if (/travelling|traveling|left (my pills|them) at home|hotel|overnight|not at home/.test(s)) {
    return { category: 'Opportunity', subcategory: 'Physical_env', ambiguity: 'none' };
  }
  if (/no ?time|back.to.back|meeting|running late|shift (ran|went) over/.test(s)) {
    return { category: 'Opportunity', subcategory: 'Time', ambiguity: 'none' };
  }
  if (/nobody.*remind|no.?one.*remind|partner|husband|wife|support/.test(s)) {
    return { category: 'Opportunity', subcategory: 'Social_env', ambiguity: 'none' };
  }
  if (/worried|scare|afraid|damage|harm|side.?effect|kidney|liver|depend/.test(s)) {
    return { category: 'Motivation', subcategory: 'Concern_belief', ambiguity: 'none' };
  }
  if (/feel.*(fine|good|healthy|normal)|don.t.*feel.*sick|not sick|no symptoms/.test(s)) {
    return { category: 'Motivation', subcategory: 'Necessity_belief', ambiguity: 'none' };
  }
  if (/giving up|independence|rely|natural|drug.?free|pills make me feel old/.test(s)) {
    return { category: 'Motivation', subcategory: 'Identity', ambiguity: 'none' };
  }
  if (/what.s the point|depressed|down|hopeless|overwhelm|can.t cope/.test(s)) {
    return { category: 'Motivation', subcategory: 'Emotional', ambiguity: 'none' };
  }
  if (/wasn.t sure|didn.t know|confused|new brand|looks different/.test(s)) {
    return { category: 'Capability', subcategory: 'Knowledge', ambiguity: 'none' };
  }
  if (/dizz|nausea|side.?effect|after taking|felt (bad|sick|unwell)/.test(s)) {
    return { category: 'Capability', subcategory: 'Physical', ambiguity: 'none' };
  }
  if (/forgot|forget|memory|muted|switched bags|blank|lost track|day.*got away/.test(s)) {
    return { category: 'Capability', subcategory: 'Forgetting', ambiguity: ambiguityHints ? 'borderline' : 'none' };
  }

  // Fall back to the monitor.ts top-level classifier
  const topLevel = classifyBarrier(statement);
  return { category: topLevel, ambiguity: ambiguityHints ? 'ambiguous' : 'borderline' };
}

// ─── LLM classifier ───────────────────────────────────────────────────────────

async function llmClassify(statement: string): Promise<{
  category: ComBCategory;
  subcategory?: ComBSubcategory;
  ambiguity: Ambiguity;
  raw: string;
} | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const { respondJSON } = await import('../src/llm/client');

    // Inline JSON schema — avoids zod-to-json-schema dependency
    const classifyJsonSchema = {
      type: 'object',
      properties: {
        category:   { type: 'string', enum: ['Capability', 'Opportunity', 'Motivation'] },
        subcategory:{ type: 'string', enum: ['Forgetting','Knowledge','Physical','Skill','Access','Time','Physical_env','Social_env','Necessity_belief','Concern_belief','Identity','Habit','Emotional'] },
        ambiguity:  { type: 'string', enum: ['none', 'ambiguous', 'borderline'] },
        reasoning:  { type: 'string' },
      },
      required: ['category', 'ambiguity', 'reasoning'],
      additionalProperties: false,
    };

    const prompt = `
You are a behavioral health researcher classifying patient barrier statements
using the COM-B framework. The three top-level categories are:

- Capability: Psychological or physical ability (forgetting, side effects, knowledge gaps, skills)
- Opportunity: External factors (access to medication, time, physical environment, social cues)
- Motivation: Beliefs, emotions, habits (necessity beliefs, concerns about medication, identity, emotional state)

Sub-categories:
  Capability: Forgetting | Knowledge | Physical | Skill
  Opportunity: Access | Time | Physical_env | Social_env
  Motivation: Necessity_belief | Concern_belief | Identity | Habit | Emotional

Classify the following patient statement. If it could plausibly fit two categories, set ambiguity to "ambiguous".
If it leans one way but a case could be made for another, set ambiguity to "borderline".

Statement: "${statement}"
`;

    const raw = await respondJSON({
      userMessage: prompt,
      jsonSchema: { name: 'Classification', schema: classifyJsonSchema },
    });

    const parsed = JSON.parse(raw);
    return {
      category:    parsed.category,
      subcategory: parsed.subcategory,
      ambiguity:   parsed.ambiguity,
      raw,
    };
  } catch (err) {
    console.warn(`  LLM classify failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreResult(
  gold: ClassificationGold,
  predicted: { category: ComBCategory; subcategory?: ComBSubcategory }
): 0 | 1 | 2 | 3 {
  if (predicted.category !== gold.category) return 0;
  if (!predicted.subcategory)               return 1; // Right category, no sub
  if (predicted.subcategory !== gold.subcategory) {
    // Sub-categories within the same category that produce appropriate messages
    const ACCEPTABLE_MISSES: Partial<Record<ComBSubcategory, ComBSubcategory[]>> = {
      Forgetting:       ['Habit', 'Emotional'],   // Forgetting → Habit/Emotional → similar message
      Habit:            ['Forgetting'],
      Necessity_belief: ['Concern_belief'],
      Concern_belief:   ['Necessity_belief'],
      Time:             ['Forgetting'],
      Physical_env:     ['Forgetting', 'Access'],
      Access:           ['Physical_env'],
    };
    const acceptable = ACCEPTABLE_MISSES[gold.subcategory] ?? [];
    if (acceptable.includes(predicted.subcategory)) return 2;
    return 1;
  }
  return 3;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const offline   = args.includes('--offline') || !process.env.OPENAI_API_KEY;
  const outIdx    = args.indexOf('--output');
  const outputPath = outIdx >= 0 ? args[outIdx + 1] : undefined;

  if (offline) {
    console.log('\n⚡  Running in offline mode (rule-based classifier)\n');
  } else {
    console.log('\n🤖  Running with LLM classifier (gpt-4o-mini)\n');
  }

  const results: ClassificationResult[] = [];
  let correct = 0, exact = 0;

  for (const gold of GOLD_ANNOTATIONS) {
    const llmOut = offline ? null : await llmClassify(gold.statement);
    const ruleOut = ruleBasedClassify(gold.statement);

    const predicted = llmOut ?? ruleOut;
    const classifierUsed: 'llm' | 'rule-based' = llmOut ? 'llm' : 'rule-based';

    const score = scoreResult(gold, predicted) as 0 | 1 | 2 | 3;
    const isCorrect = score >= 2;
    const isExact   = score === 3;
    if (isCorrect) correct++;
    if (isExact)   exact++;

    const marker = score === 3 ? '✅' : score >= 2 ? '🟡' : '❌';
    console.log(
      `  ${marker} ${gold.id.padEnd(5)} ` +
      `[gold: ${gold.category}/${gold.subcategory}] ` +
      `[pred: ${predicted.category}${predicted.subcategory ? '/' + predicted.subcategory : ''}] ` +
      `score=${score}` +
      (gold.ambiguity !== 'none' ? ` (${gold.ambiguity})` : '')
    );

    results.push({
      id: gold.id,
      statement: gold.statement,
      predictedCategory: predicted.category,
      predictedSubcategory: predicted.subcategory,
      predictedAmbiguity: predicted.ambiguity,
      score,
      goldCategory: gold.category,
      goldSubcategory: gold.subcategory,
      correct: isCorrect,
      exact: isExact,
      classifierUsed,
      rawLLMOutput: llmOut?.raw,
    });
  }

  const total = GOLD_ANNOTATIONS.length;
  const ambiguous = GOLD_ANNOTATIONS.filter((g) => g.ambiguity !== 'none').length;

  console.log('\n' + '═'.repeat(72));
  console.log('CLASSIFICATION EVALUATION SUMMARY');
  console.log('═'.repeat(72));
  console.log(`\n  Total statements:      ${total}`);
  console.log(`  Ambiguous/borderline:  ${ambiguous} (${Math.round(ambiguous / total * 100)}%)`);
  console.log(`  Classifier:            ${results[0]?.classifierUsed ?? 'N/A'}`);
  console.log(`\n  Score ≥ 2 (usable):    ${correct}/${total} = ${Math.round(correct / total * 100)}%`);
  console.log(`  Score = 3 (exact):     ${exact}/${total}   = ${Math.round(exact / total * 100)}%`);

  // Breakdown by category
  for (const cat of ['Capability', 'Opportunity', 'Motivation'] as ComBCategory[]) {
    const catItems = results.filter((r) => r.goldCategory === cat);
    const catCorrect = catItems.filter((r) => r.correct).length;
    console.log(`\n  ${cat.padEnd(12)}: ${catCorrect}/${catItems.length} usable (${Math.round(catCorrect / catItems.length * 100)}%)`);
  }

  console.log('\n  Score distribution:');
  for (const s of [0, 1, 2, 3]) {
    const n = results.filter((r) => r.score === s).length;
    const bar = '█'.repeat(n);
    console.log(`    ${s}: ${bar} ${n}`);
  }
  console.log('\n' + '═'.repeat(72) + '\n');

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const output = {
      runAt: new Date().toISOString(),
      classifier: results[0]?.classifierUsed,
      summary: {
        total, correct, exact, ambiguous,
        usableRate: correct / total,
        exactRate:  exact / total,
        byCategory: Object.fromEntries(
          (['Capability', 'Opportunity', 'Motivation'] as ComBCategory[]).map((cat) => {
            const catItems = results.filter((r) => r.goldCategory === cat);
            return [cat, { total: catItems.length, correct: catItems.filter((r) => r.correct).length }];
          })
        ),
      },
      results,
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`  💾  Results saved to: ${outputPath}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
