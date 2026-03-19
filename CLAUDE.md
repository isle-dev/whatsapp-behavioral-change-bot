# Medi repository notes for Claude

This file is the working agreement for making changes to this codebase.

## Product goal

Medi is a WhatsApp chatbot that supports medication adherence. The system should feel lightweight and safe, it should respect quiet hours and user preferences.

## Architecture at a glance

The code is intentionally kept small and modular. The core flow is:

1) Understanding: create and update a patient profile from onboarding and commands
2) Monitoring: record simple adherence check-ins like Y or N
3) Prompting: generate reminder copy based on profile preferences
4) Scheduling: persist routines in Postgres and trigger reminders when due

Key files:

- `src/modules/orchestration.js` is the single entry point for inbound user messages
- `src/modules/onboarding.js` contains the onboarding prompts and profile writes
- `src/modules/profile.js` stores the patient profile locally under `data/profiles.json`
- `src/modules/monitor.js` stores adherence events locally under `data/adherence.json`
- `src/modules/decisionEngine.js` generates reminder text and optional voice payload
- `src/modules/scheduler.js` polls Postgres for due routines and calls the decision engine
- `src/modules/db.js` manages the Postgres connection pool

## Data storage rules

### What goes into Postgres

Only scheduling metadata goes into the database. We do not store medication names or clinical content in the routines table.

Table: `routines`

- `id` TEXT primary key
- `user_id` TEXT
- `times` TEXT[] of HH:MM strings
- `days` TEXT[] optional, values like Mon Tue Wed Thu Fri Sat Sun
- `quiet_start` TEXT optional, HH:MM
- `quiet_end` TEXT optional, HH:MM
- `active` BOOLEAN

Migration is in `scripts/dbInit.js` and should remain idempotent.

### What stays in JSON for now

Profiles and adherence logs are stored in `data/` as JSON. This is a deliberate tradeoff while the refactor stabilizes.

- `data/profiles.json` includes user preferences and onboarding state
- `data/adherence.json` includes timestamped Y or N entries

If you migrate these to Postgres later, keep the schema minimal and avoid raw chat logs.

## Commands

This repo uses pnpm only.

- Install: `pnpm install`
- Init DB: `pnpm run db:init`
- Dev: `pnpm dev`
- Smoke test: `pnpm test`

Docker:

- `docker compose up --build`

## Environment variables

Required for DB:

- `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

Optional:

- `USE_WHATSAPP=true` to run WhatsApp Web pairing
- `DEFAULT_TONE` for initial tone

## Message and command behavior

### Onboarding

On first contact, onboarding asks for morning time, evening time, then tone. After onboarding completes, a routine is created in Postgres using the collected times.

### Commands

- `Tone: encouraging|empathetic|neutral` updates the tone
- `Voice` enables voice reminders for that user
- `Y` or `Yes` logs a taken dose
- `N` or `No` logs a missed dose

## Development guidelines

- Keep file count low, prefer small modules over deep folder trees
- Avoid adding new dependencies unless necessary
- Keep prompts short and safe, do not produce medical advice, do not diagnose
- Avoid storing raw message content, store only structured outcomes
- Any scheduler changes must preserve quiet hour logic and avoid duplicate sends

## When adding new features

1) Start with orchestration, add a single new command or intent
2) Store only minimal data needed to deliver the behavior
3) Add a small smoke test under `scripts/` if the change is risky
4) Update README when setup or behavior changes

## Deployment notes

WhatsApp Web is for testing and demos. For a multi-user deployment, migrate to the WhatsApp Cloud API webhook path, then move all persistent state into Postgres.