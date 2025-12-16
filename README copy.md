# MediDoc WhatsApp Chatbot
## Getting Started

### Prerequisites

* **Node.js 16 or later** (the project is tested on Node 18)
* **npm** – package manager (note: `pnpm` currently does not work due to dependency issues – please use `npm install`)
* An **OpenAI API key** (optional but recommended for real responses)
* **WhatsApp** on your phone for scanning the QR code or a **Meta Business API** account and credentials

### Installation

1. **Clone the repository**

   ```bash
   git clone the repo
   cd medidoc
   ```

2. **Install dependencies** – `npm install` must be used because `pnpm install` is currently unsupported as noted in `fixes.md`.

   ```bash
   npm install
   ```

3. **Create your environment file** – copy the example and fill in your configuration.  You can do this manually or via the interactive setup script.

   ```bash
   # copy example values
   cp env.example .env
   
   # or run interactive setup (prompts for ports, API keys, etc.)
   npm run setup
   ```
MediDoc is a **WhatsApp‑based virtual assistant** designed to help patients stay on track with their daily medication and habit routines.  
It combines **Large Language Models (LLMs)**, **conversation memory** and the **COM‑B behavioural framework** to deliver Just‑In‑Time Adaptive Interventions (JITAIs) over WhatsApp.

At its core MediDoc is a Node.js/Express application that can operate in two modes:

* **WhatsApp Web mode** – library to log in via QR code and send/receive messages through a personal WhatsApp account.  
* **WhatsApp Business API mode** – receives messages via a webhook and responds via the official Meta Business API.

An optional admin API exposes conversation statistics, lets you view/clear conversations and adjust LLM parameters.  
Experimental TypeScript modules implement structured decision and chat prompts based on the COM‑B framework; these are useful for testing the JITAI logic but are not yet integrated into the main bot.

## Features

- 💬 **Conversational AI** – integrates with OpenAI’s GPT models.  If no API key is provided, the bot falls back to friendly placeholder replies instead of failing.
- 🧠 **Conversation history** – every chat maintains its own in‑memory history so that the LLM has context for follow‑up messages.
- 🔄 **Dual WhatsApp integration** – connect via QR code with or set up a webhook for the Business API.
- 🛡️ **Safety guardrails** – responses avoid prescribing or changing medication doses and politely refuse clinical questions.  Fallback messages and error handling prevent crashes.
- 📈 **Admin dashboard endpoints** – view bot status, see conversations, clear histories and tune LLM parameters over an authenticated API.
- 🧪 **JITAI decision & chat modules (experimental)** – TypeScript functions implement structured decision making and chat responses using the COM‑B framework and JSON schema validation.  These are provided for experimentation and are not yet wired into the bot.

## Tech Stack

* **Node.js 18** and **Express** – server and routing logic
* **whatsapp-web.js** – connects to WhatsApp Web via Puppeteer
* **Axios** – used for the Business API and admin requests
* **OpenAI SDK** – interacts with GPT models for chat/decision logic
* **TypeScript** – experimental JITAI modules (`src/llm` and `src/services/chatter.ts`/`decider.ts`)
* **Jest** – basic unit tests for the conversation manager and LLM service

## Background & Research Context

MediDoc sits at the intersection of digital health research and cutting‑edge AI.  
Recent work has shown that large language models are promising tools for generating JITAI content.  A study at CHI ’25 tested GPT‑4 on cardiac rehabilitation scenarios and found that GPT‑4–generated JITAIs outperformed those created by both laypersons and healthcare professionals across metrics such as appropriateness, engagement, effectiveness, and professionalism.  These findings suggest that generative models can produce high‑quality, context‑aware interventions at scale.

Our repository also draws inspiration from the Welch TRaC grant proposal for an AI agent to promote hypertension medication adherence.  The proposal outlines a phased plan to build and evaluate a WhatsApp‑based agent that uses the COM‑B (Capability, Opportunity and Motivation) framework to personalize prompts and monitor adherence.  The first aim is to develop a prototype that asks patients about preferences and barriers, sends tailored prompts and feedback, and monitors adherence.  Subsequent aims involve expert review of LLM‑generated JITAI messages and user testing with hypertensive patients to refine the system.  These goals align closely with MediDoc’s architecture, which combines a conversation manager, LLM integration, and COM‑B‑based decision logic.

COM‑B posits that behaviour is driven by a combination of **capability**, **opportunity**, and **motivation**; interventions should therefore address these components to promote adherence.  MediDoc’s experimental TypeScript modules encode COM‑B tags and use structured JSON outputs to indicate which component a message targets, providing a foundation for future adaptive messaging strategies.



   The key variables are:

   | Variable | Description |
   |---------|-------------|
   | `PORT` | Port for the Express server (default `3000`). |
   | `OPENAI_API_KEY` | OpenAI API key used by the LLM service. If omitted the bot returns fallback messages. |
   | `OPENAI_MODEL` | Model name (e.g., `gpt-3.5-turbo`, `gpt-4o-mini`). |
   | `WHATSAPP_ACCESS_TOKEN` | Meta Business API access token (required for Business API mode). |
   | `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business phone number ID. |
   | `WHATSAPP_VERIFY_TOKEN` | Verify token used during webhook setup. |
   | `ADMIN_API_KEY` | Simple API key used to secure admin endpoints. |

   Variables for alternative LLM providers or databases can also be defined (see `env.example` for hints).

### Running Locally

There are two main ways to run the bot locally:

#### Development (WhatsApp Web mode)

This mode launches a local Express server and uses `whatsapp-web.js` to emulate WhatsApp Web.  The first time you run the bot a QR code will be printed to the terminal.  Scan it with the WhatsApp mobile app to authorise the session.

```bash
npm run dev
```

After the server starts it prints a QR code in the console.  Scan the code in your WhatsApp app to link the bot.  Messages beginning with **“Hi Doc”** trigger the bot; all other messages are ignored.

To stop the bot press `Ctrl+C` in the terminal.

#### Production

Use `npm start` to run the compiled server with logging but without nodemon.  This is the command used inside the Docker container:

```bash
npm start
```

#### WhatsApp Business API mode

If you have Business API credentials set (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_VERIFY_TOKEN`), incoming messages are delivered via the `/webhook` endpoint.  Configure your webhook URL in the Meta Developer Console.  The bot will respond using the Business API instead of printing a QR code.  Health checks for the webhook are available at `/webhook/health`.

### Running with Docker

The repository includes a `Dockerfile` and `docker-compose.yml` for containerised deployment.  With Docker installed, run:

```bash
docker-compose up -d
```

The `whatsapp-chatbot` service exposes port `3000` by default and reads environment variables from your host.  A second `nginx` service is provided as a simple reverse proxy for production deployments but is optional.  To rebuild the image after changes use `docker-compose build`.

### Demo and Testing

To try out the COM‑B‑based structured outputs without connecting to WhatsApp, there are two TypeScript scripts under `src/scripts`:

* **`test-decision.ts`** – runs a sample “decision” task that determines whether the bot should send a proactive nudge and returns a structured JSON response.  To run it:

  ```bash
  node src/scripts/test-decision.ts
  ```

  The script prints a JSON object containing fields like `send`, `short_notification`, `com_b_tags`, `reason_codes` and more.  See `src/llm/decisionPrompt.ts` for the prompt logic.

* **`test-chat.ts`** – runs a sample “chat” task that takes a user message and returns a structured JSON reply with COM‑B tags, safety flags and suggested quick‑tap replies.  Run it via:

  ```bash
  node src/scripts/test-chat.ts
  ```

These scripts are useful for experimenting with the new JITAI logic in isolation.  They rely on the OpenAI API and require `OPENAI_API_KEY` to be set; otherwise they will throw an error.

## API Reference

The Express app exposes public and admin endpoints.  All responses are JSON.

### Public Endpoints

| Method & Path | Description |
|---------------|-------------|
| `GET /` | Returns basic API information and available routes. |
| `GET /health` | Health check returning `status: OK` and timestamp. |
| `GET /webhook` | Verification endpoint for the Business API.  Echoes the challenge value when the correct `hub.verify_token` is supplied. |
| `POST /webhook` | Receives inbound messages from the Business API and sends LLM responses.  Only plain text messages are supported. |

### Admin Endpoints

All admin endpoints require a `x-api-key` header matching the `ADMIN_API_KEY` in your `.env` file.

| Method & Path | Description |
|---------------|-------------|
| `GET /admin/status` | Returns bot readiness, current LLM configuration and conversation statistics. |
| `GET /admin/conversations` | Lists all conversation IDs along with message counts and last activity times. |
| `GET /admin/conversations/:id` | Returns a summary and full message history for a specific conversation. |
| `DELETE /admin/conversations/:id` | Clears a conversation’s history. |
| `PUT /admin/config/llm` | Updates LLM settings (`model`, `maxTokens`, `temperature`). |
| `GET /admin/config/llm` | Retrieves current LLM settings. |
| `POST /admin/test-message` | Sends a test WhatsApp message to a given phone number (Web mode only). |
| `GET /admin/stats` | Returns conversation statistics, bot status and basic process information. |
| `GET /admin/health` | Health check for admin endpoints. |

## Current Status

The following components are **working**:

- The Express server starts correctly and exposes health, webhook and admin endpoints.
- WhatsApp Web mode successfully authenticates via QR code and sends/receives text messages when they begin with “Hi Doc”.  Duplicate messages and bot‑sent messages are properly deduplicated.
- Conversation history is stored in memory and automatically pruned after reaching 20 messages per user.
- The LLM service integrates with OpenAI’s chat completions API and falls back to friendly generic responses when no API key is configured.
- The admin API returns conversation statistics, supports clearing histories and allows updating LLM parameters.
- Experimental TypeScript modules for COM‑B decision/chat prompts work when run via the provided test scripts and enforce JSON schema validation.

The project **needs further development** in the following areas:

- **Integration of JITAI modules** – the TypeScript COM‑B modules are separate from the main bot.  Future work should unify the logic so that proactive decisions and structured chat responses power the WhatsApp bot.
- **Database support** – all conversation history is stored in memory and lost on restart.  Adding a database (e.g., PostgreSQL or MongoDB) will enable persistence across restarts and long‑term analytics.
- **pnpm support** – `npm install` works but `pnpm install` currently fails as noted in `fixes.md`.  Investigate dependency resolution and update the lockfile.
- **Multi‑language and user preferences** – while the prompts accept tone, language and name preferences, these are not yet persisted per user.
- **Media and buttons** – only plain text messages are currently supported.  Extending the bot to send and receive media (images, documents) and quick‑reply buttons would improve user experience.
- **Security hardening** – the admin API uses a simple API key.  Consider migrating to OAuth or another robust authentication mechanism and enable HTTPS in production.
- **Testing** – expand unit tests beyond the conversation manager and LLM service; add integration tests for the webhook and admin endpoints.

## Roadmap / TODO

1. **Incorporate COM‑B decision engine** into the bot’s message flow so that proactive nudges follow the JITAI rules.
2. **Persist conversations** in a database and implement cleanup jobs based on retention policies.
3. **Full Business API support** including signature verification and message templates.
4. **Add multilingual responses** leveraging user preferences and model capabilities.
5. **Improve deployment** by providing ready‑to‑use deployment scripts for cloud platforms and automating TLS certificate generation.
6. **Refactor codebase** to gradually adopt TypeScript across the server for better type safety.
7. **Implement rate limiting** to prevent abuse and control costs when using paid LLM APIs.

8. **Domain expert review of JITAI content** – generate sample JITAI decisions and messages with the bot and obtain feedback from clinicians and behavioural scientists to refine tone, cadence and appropriateness.
9. **User testing with patients** – run a pilot study with a small cohort of hypertensive patients to assess the usability and clarity of prompts and collect feedback for version 1.0 refinement.

## License

This project is licensed under the MIT License.  See the `LICENSE` file for details.
