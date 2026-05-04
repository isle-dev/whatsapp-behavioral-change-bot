# Medi WhatsApp Chatbot

Medi is a WhatsApp chatbot that helps patients stay on track with their medication. It builds a short profile of each user during onboarding, uses that profile to write personalised reminder messages, and adapts its framing based on the barriers that are getting in the way.

The system runs as a Node.js/Express application in one of two modes:

- **WhatsApp Web mode** — logs in via QR code using `whatsapp-web.js`. Good for local development and demos.
- **WhatsApp Business API mode** — receives messages via a Meta webhook and responds through the official API. This is the production path.

An optional admin API lets you inspect conversations, clear histories, and adjust LLM parameters without touching the database directly.

## Features

- Conversational AI via OpenAI GPT models, with plain fallback replies if no API key is set.
- Per-user conversation context is maintained across messages.
- Connects to WhatsApp via QR code (dev) or the Business API webhook (production).
- Responses are safety-guarded and will not prescribe doses or answer clinical questions.
- Admin endpoints for monitoring bot status, conversation state, and LLM config.
- A JITAI decision engine classifies patient barriers using the COM-B framework and generates tailored message copy.

## Tech Stack

- **Node.js 18** and **Express**
- **TypeScript** compiled with `tsc`
- **whatsapp-web.js** — WhatsApp Web via Puppeteer
- **OpenAI SDK** — GPT model integration
- **Zod** — schema validation for LLM outputs
- **Postgres** (`pg`) — routine scheduling and trait profile storage
- **Axios** — Business API HTTP requests
- **Helmet / Morgan / CORS** — HTTP middleware
- **Jest + ts-jest** — unit tests
- **tsx** — dev server with hot reload

## Getting Started

### Prerequisites

- Node.js 18 or later
- pnpm (`npm install -g pnpm`)
- An OpenAI API key (optional — the bot runs without one but returns placeholder replies)
- WhatsApp on your phone (Web mode) or a Meta Business API account (webhook mode)

### Installation

1. Clone the repository:

   ```bash
   git clone <repo-url>
   cd medi
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create your environment file:

   ```bash
   cp .env.example .env
   ```

   Or run the interactive setup script:

   ```bash
   pnpm run setup
   ```

4. Build the TypeScript source:

   ```bash
   pnpm run build
   ```

5. Initialise the database:

   ```bash
   pnpm run db:init
   ```

### Environment Variables

| Variable | Description |
|---------|-------------|
| `PORT` | Port for the Express server (default `3000`). |
| `OPENAI_API_KEY` | OpenAI API key. If omitted the bot returns fallback messages. |
| `OPENAI_MODEL` | Model name (e.g. `gpt-4o-mini`). |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business API access token. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID. |
| `WHATSAPP_VERIFY_TOKEN` | Verify token used during webhook setup. |
| `ADMIN_API_KEY` | Key to secure admin endpoints. |
| `DATABASE_URL` | Postgres connection string (or set `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` individually). |
| `USE_WHATSAPP` | Set to `true` to enable whatsapp-web.js QR-code mode (dev/demo only). |
| `TIMEZONEDB_API_KEY` | TimeZoneDB key for resolving a shared location to an IANA timezone. Free tier at timezonedb.com/register. Falls back to manual selection if unset. |
| `DEFAULT_TONE` | Initial reminder tone for new users: `encouraging`, `empathetic`, or `neutral`. |

### Running Locally

Development with hot reload:

```bash
pnpm dev
```

Production:

```bash
pnpm run build
pnpm start
```

Tests:

```bash
pnpm test
```

Type check only:

```bash
pnpm typecheck
```

### Docker

```bash
docker compose up --build
```

## Onboarding Flow

On first contact, a new patient is walked through a 19-step interview that builds their JITAI trait profile. The steps are grouped into six blocks:

| Block | Steps | Purpose |
|-------|-------|---------|
| Identity | Name, timezone | Personalise and schedule correctly |
| Medication and preferences | Medication timing, check-in frequency | Derive reminder times and cadence |
| Weekday routine | Morning routine, medication anchor, storage location, memory aids | Understand existing habits to build on |
| Weekend and schedule | Weekend routine difference, schedule consistency | Detect variability in routine |
| Recent adherence | Yesterday's dose, barrier if missed | Contextual baseline |
| Beliefs and support | General barriers, social support, necessity belief, concerns belief, illness understanding | Tailor message framing |
| Setup | Tone, confirm | Communication style |

Reminder times are derived from the reported medication timing — no separate time question is asked.

### Timezone detection

At the timezone step, the user can select from a list or share their location as a WhatsApp attachment. If `TIMEZONEDB_API_KEY` is set the bot resolves the coordinates to an IANA timezone and moves on automatically. If the key is unset or the lookup fails it falls back to the manual list.

### User controls during onboarding

- `skip` — accept the default for the current step.
- `help` — show contextual help for the step.
- `restart` — clear all answers and start over.
- `change [field]` — jump back to any step (e.g. `change timezone`, `change tone`).

### Data storage

- `data/profiles.json` — profile fields and current `onboardingStep`.
- Postgres `routines` — reminder times, quiet window, and active flag.
- Postgres `trait_profiles` — all 14 structured JITAI fields plus open-ended text.
- Postgres `onboarding_responses` — full audit log of every answer given during onboarding.
- Postgres `sent_log` — record of every reminder message sent, used to prevent duplicate sends.

## API Reference

### Public Endpoints

| Method and Path | Description |
|-----------------|-------------|
| `GET /` | API info. |
| `GET /health` | Health check. |
| `GET /webhook` | Business API webhook verification. |
| `POST /webhook` | Receives inbound messages. |

### Admin Endpoints

All admin endpoints require an `x-api-key` header matching `ADMIN_API_KEY`.

| Method and Path | Description |
|-----------------|-------------|
| `GET /admin/status` | Bot readiness, LLM config, conversation stats. |
| `GET /admin/conversations` | List all conversations. |
| `GET /admin/conversations/:id` | Conversation summary and messages. |
| `DELETE /admin/conversations/:id` | Clear a conversation. |
| `PUT /admin/config/llm` | Update LLM settings. |
| `GET /admin/config/llm` | Current LLM settings. |
| `POST /admin/test-message` | Send a test message (Web mode only). |
| `GET /admin/stats` | Stats, bot status, system info. |
| `GET /admin/health` | Admin health check. |

## Demo Mode

The demo scripts let you run the full patient experience in a terminal without a WhatsApp connection. Useful for development, screen recordings, and usability reviews.

### Seed demo personas

```bash
pnpm demo:seed
```

This writes pre-built profiles for five WHO-framework personas (Jane, Robert, James, Gia, Amira) into `data/profiles.json` and generates 14 days of synthetic adherence history in `data/adherence.json`.

To reset from scratch:

```bash
pnpm demo:seed:clear
```

### Run a demo conversation

```bash
pnpm demo                          # interactive menu — pick a persona
pnpm demo -- --persona jane        # jump straight to Jane's scenario
pnpm demo -- --persona robert      # skeptical patient, belief reframing
pnpm demo -- --all                 # run all five personas and an adherence summary
pnpm demo -- --onboarding          # walk through the full onboarding flow
```

Each persona demonstrates a different COM-B barrier type:

| Persona | Archetype | Barrier type |
|---------|-----------|--------------|
| Jane | ICU nurse, rotating shifts | Opportunity — physical environment |
| Robert | Skeptical retiree, 12-year HTN | Motivation — necessity and concern beliefs |
| James | Low-income elderly, polypharmacy | Opportunity — access and Capability |
| Gia | Stressed caregiver | Opportunity — competing demands |
| Amira | Travelling consultant | Capability — timezone and alarm confusion |

The demo also shows a scheduler dry-run: which users would receive a reminder right now and what the generated message would look like.

---

## Evaluation Scripts

The evaluation framework scores message quality and COM-B classification accuracy.

### Message quality

```bash
pnpm eval:messages
# save JSON output:
pnpm exec tsx scripts/evalMessages.ts --output results/eval_$(date +%Y%m%d).json
```

Scores each generated message on six dimensions:

| Dimension | Scale | Method |
|-----------|-------|--------|
| Safety | 0–2 (harmful / ambiguous / safe) | Rule-based and LLM flags |
| Relevance | 0–2 (not / partial / fully) | Name, tone, and context matching |
| Readability | Flesch-Kincaid Grade and Reading Ease | Formula (target: grade 8 or below, ease 60 or above) |
| Tone and empathy | -1 to +1 / 0–1 | Marker-based sentiment scoring |
| Actionability | 0–2 | Imperative verb and time-bound target detection |
| Accuracy flags | List of concerns | Hallucination, overconfidence, and clinical claim detection |

The test battery includes eight cases covering standard reminders, barrier responses, belief reframing, a safety test, and a crisis-language test.

### COM-B classification accuracy

```bash
pnpm eval:classify           # LLM classifier (requires OPENAI_API_KEY)
pnpm eval:classify:offline   # fast rule-based classifier (no API key needed)
# save results:
pnpm exec tsx scripts/evalClassification.ts --output results/classify_$(date +%Y%m%d).json
```

Scores the model's ability to classify patient barrier statements:

| Score | Meaning |
|-------|---------|
| 0 | Wrong large category (Motivation vs Capability vs Opportunity) |
| 1 | Correct large category, obviously wrong subcategory |
| 2 | Correct large category, wrong subcategory but appropriate message would still result |
| 3 | Correct large category and correct subcategory |

The gold-standard set contains 45 patient statements across all three COM-B categories and all five personas, covering clear, borderline, and ambiguous cases.

### Run all evaluations

```bash
pnpm eval:all
```

---

## System Architecture

```
Inbound message
      │
      ▼
┌─────────────────────────────────┐
│  orchestration.ts               │  ← single entry point for all messages
│  (routes to onboarding or       │
│   post-onboarding handlers)     │
└──────┬──────────────────────────┘
       │                      │
       ▼                      ▼
┌─────────────┐     ┌─────────────────────┐
│ onboarding  │     │ Post-onboarding      │
│ .ts         │     │ commands:           │
│ 19-step     │     │  Y/N → monitor.ts   │
│ state       │     │  Tone: X            │
│ machine     │     │  Change [field]     │
└──────┬──────┘     │  Natural language   │
       │            │  profile updates    │
       ▼            └──────────┬──────────┘
┌─────────────┐                │
│ profile.ts  │                ▼
│ (JSON store)│    ┌───────────────────────┐
└─────────────┘    │ monitor.ts            │
                   │ Logs Y/N dose events  │
                   │ Computes streaks,     │
                   │ trend messages        │
                   └──────────┬────────────┘
                              │
                   ┌──────────▼────────────┐
                   │ scheduler.ts          │
                   │ Polls for due         │
                   │ routines, enforces    │
                   │ quiet hours, fires    │
                   │ reminder messages     │
                   └──────────┬────────────┘
                              │
                   ┌──────────▼────────────┐
                   │ decider.ts            │
                   │ LLM-powered decision  │
                   │ engine (COM-B tags,   │
                   │ safety flags, etc.)   │
                   └───────────────────────┘
```

## Module Reference

| Module | File | Purpose |
|--------|------|---------|
| Understanding | `src/modules/onboarding.ts` | 19-step JITAI trait profile interview |
| Understanding | `src/modules/profile.ts` | Patient profile JSON store |
| Monitoring | `src/modules/monitor.ts` | Dose event logging, adherence summaries, trend messages |
| Prompting | `src/services/decider.ts` | LLM-powered JITAI decision engine |
| Prompting | `src/services/chatter.ts` | LLM-powered conversational response handler |
| Scheduling | `src/modules/scheduler.ts` | Reminder scheduling, quiet-hour guard, polling loop |
| Routing | `src/modules/orchestration.ts` | Single entry point for all inbound messages |
| LLM | `src/llm/` | OpenAI client, prompts, Zod schemas |
| API | `src/routes/webhook.ts` | WhatsApp Business API webhook |
| API | `src/routes/admin.ts` | Admin dashboard endpoints |

## License

MIT
