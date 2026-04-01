# Medi WhatsApp Chatbot

Medi is a **WhatsApp-based virtual assistant** designed to help patients stay on track with their daily medication and habit routines.
It combines **Large Language Models (LLMs)**, **conversation memory** and the **COM-B behavioural framework** to deliver Just-In-Time Adaptive Interventions (JITAIs) over WhatsApp.

At its core Medi is a Node.js/Express application that can operate in two modes:

* **WhatsApp Web mode** – uses `whatsapp-web.js` to log in via QR code and send/receive messages through a personal WhatsApp account.
* **WhatsApp Business API mode** – receives messages via a webhook and responds via the official Meta Business API.

An optional admin API exposes conversation statistics, lets you view/clear conversations and adjust LLM parameters.

## Features

- 💬 **Conversational AI** – integrates with OpenAI's GPT models. Falls back to friendly placeholder replies when no API key is configured.
- 🧠 **Conversation history** – every chat maintains its own in-memory history for context.
- 🔄 **Dual WhatsApp integration** – connect via QR code or set up a webhook for the Business API.
- 🛡️ **Safety guardrails** – responses avoid prescribing medication doses and politely refuse clinical questions.
- 📈 **Admin dashboard endpoints** – view bot status, see conversations, clear histories and tune LLM parameters.
- 🧪 **JITAI decision & chat modules** – TypeScript functions implement structured decision making using the COM-B framework.

## Tech Stack

* **Node.js 18** and **Express**
* **TypeScript** – entire codebase compiled with `tsc`
* **whatsapp-web.js** – connects to WhatsApp Web via Puppeteer
* **Axios** – used for Business API requests
* **OpenAI SDK** – interacts with GPT models
* **Jest + ts-jest** – unit tests
* **tsx** – dev server with hot reload

## Getting Started

### Prerequisites

* **Node.js 18 or later**
* **pnpm** – `npm install -g pnpm`
* An **OpenAI API key** (optional but recommended)
* **WhatsApp** on your phone (Web mode) or a **Meta Business API** account

### Installation

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd medi
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Create your environment file**

   ```bash
   cp .env.example .env
   # fill in your API keys and configuration
   ```

   Or run the interactive setup script:

   ```bash
   pnpm run setup
   ```

4. **Build the TypeScript source**

   ```bash
   pnpm run build
   ```

5. **(Optional) Initialise the database**

   ```bash
   pnpm run db:init
   ```

### Environment Variables

| Variable | Description |
|---------|-------------|
| `PORT` | Port for the Express server (default `3000`). |
| `OPENAI_API_KEY` | OpenAI API key. If omitted the bot returns fallback messages. |
| `OPENAI_MODEL` | Model name (e.g., `gpt-3.5-turbo`, `gpt-4o-mini`). |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business API access token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business phone number ID. |
| `WHATSAPP_VERIFY_TOKEN` | Verify token used during webhook setup. |
| `ADMIN_API_KEY` | API key to secure admin endpoints. |
| `DATABASE_URL` | Postgres connection string (or set `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`). |
| `USE_WHATSAPP` | Set to `true` to enable whatsapp-web.js QR-code mode (dev/demo only). |
| `TIMEZONEDB_API_KEY` | TimeZoneDB API key for inferring timezone from a shared location. Free tier at timezonedb.com/register. Optional — falls back to manual selection if unset. |
| `DEFAULT_TONE` | Initial reminder tone for new users: `encouraging`, `empathetic`, or `neutral`. |

### Running Locally

#### Development (hot reload)

```bash
pnpm dev
```

#### Production

```bash
pnpm run build
pnpm start
```

#### Tests

```bash
pnpm test
```

#### Type check

```bash
pnpm typecheck
```

### Running with Docker

```bash
docker compose up --build
```

## Onboarding Flow

New patients are guided through a 19-step JITAI trait profile interview on first contact. The questions are grouped into six blocks:

| Block | Steps | Purpose |
|-------|-------|---------|
| Identity | Name, timezone | Personalise and schedule correctly |
| Medication & preferences | Medication timing, check-in frequency | Derive reminder times and cadence |
| Weekday routine | Morning routine, medication anchor, storage location, memory aids | Understand existing habits to build on |
| Weekend & schedule | Weekend routine difference, schedule consistency | Detect variability in routine |
| Recent adherence | Yesterday's dose, barrier if missed | Contextual baseline |
| Beliefs & support | General barriers, social support, necessity belief, concerns belief, illness understanding | Tailor message framing |
| Setup | Tone, confirm | Communication style |

Reminder times are derived automatically from the reported medication timing — no separate time question.

### Timezone detection

At the timezone step the user can either select from a list or **share their location** (WhatsApp attachment → Location). If `TIMEZONEDB_API_KEY` is set the bot resolves the coordinates to an IANA timezone string and advances automatically. If the key is unset or the lookup fails it falls back to the manual selection prompt.

### User controls

- **skip** — accept the default for the current step.
- **help** — show contextual help.
- **restart** — wipe answers and start over.
- **change [field]** — jump back to any step (e.g. `change timezone`, `change tone`).

### Data storage

- `data/profiles.json` — all profile fields and current `onboardingStep`.
- Postgres `routines` table — reminder times, `quiet_start`, `quiet_end`, and `active` flag.
- Postgres `trait_profiles` table — all 14 structured JITAI fields plus open-ended text responses.
- Postgres `onboarding_responses` table — full audit log of every onboarding answer.

## API Reference

### Public Endpoints

| Method & Path | Description |
|---------------|-------------|
| `GET /` | API info. |
| `GET /health` | Health check. |
| `GET /webhook` | Business API webhook verification. |
| `POST /webhook` | Receives inbound messages. |

### Admin Endpoints

All admin endpoints require `x-api-key` header matching `ADMIN_API_KEY`.

| Method & Path | Description |
|---------------|-------------|
| `GET /admin/status` | Bot readiness, LLM config, conversation stats. |
| `GET /admin/conversations` | List all conversations. |
| `GET /admin/conversations/:id` | Conversation summary and messages. |
| `DELETE /admin/conversations/:id` | Clear a conversation. |
| `PUT /admin/config/llm` | Update LLM settings. |
| `GET /admin/config/llm` | Current LLM settings. |
| `POST /admin/test-message` | Send a test message (Web mode). |
| `GET /admin/stats` | Stats, bot status, system info. |
| `GET /admin/health` | Admin health check. |

## License

MIT
