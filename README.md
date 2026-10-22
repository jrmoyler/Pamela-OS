# Pamela OS

**The operating system for A Cup of Compassion.** One installable, branded Progressive Web App that replaces the reference stack (~$211/mo). It covers CRM, pipelines, meetings, an AI receptionist, funnels, booking, payments, email and text campaigns, social DMs, video, design, music and voice studios, work management, and the automation glue. RJ is the operator layer on top of all of it.

Everything happens inside Pamela OS, and the UI never sends her somewhere else. External services are called server-side, and **nothing reaches another person until Pamela approves it.**

---

## Quick start (local, zero config)

```bash
npm install
npm run dev            # http://localhost:3000 → first run asks you to create the owner account
```

With no `DATABASE_URL`, Pamela OS runs on an embedded Postgres (PGlite) stored in `./.data`, and files go to `./storage`. Every module works without any keys:

- **Delivery** starts in **Sandbox** mode. Approved items are recorded on the timeline but not delivered.
- **RJ** runs in offline mode, handling everyday commands directly against her data.
- **AI cleanup and drafting** fall back to the custom dictionary and on-brand templates.

Connect keys in **Settings → Connections** (stored AES-256-GCM encrypted) or as environment variables (see `.env.example`). Then flip delivery to **Live**.

```bash
npm run typecheck      # TypeScript
npm test               # unit tests (brand rules, blackout scheduling, dictionary, automations)
npm run build          # production build
```

---

## Architecture

```
 Phone / laptop (installed PWA)
        │  HTTPS
 ┌──────▼─────────────────────────────── Next.js 15 (Vercel or VPS) ───────────────────────────────┐
 │  App Router UI (React 19, Tailwind)     Server Actions + API routes      Public: /p /book /pay   │
 │  ─ every module is a route in one authenticated shell, brand-locked                              │
 │                                                                                                  │
 │  lib/events  ── emit() ─▶ automations + sequences ─▶ automation_runs (every step logged)         │
 │  lib/approvals ── the ONLY path to lib/outbound (email · SMS · DM · posts · payments · voice)    │
 │  lib/ai      ── router: Hermes (RJ) · Meta Muse · Claude · ChatGPT · Gemini, per-task ordering   │
 │  lib/jobs    ── queue for heavy work (video, transcription, voice, music)                        │
 └──────┬──────────────────────────────┬───────────────────────────────┬───────────────────────────┘
        │                              │                               │
  Postgres (Supabase)         Object storage (Supabase)        Small VPS: Hermes Agent + `npm run worker`
  one database she owns       recordings, videos, designs      (ffmpeg, optional Whisper, scheduler)
```

| Concern | Where |
|---|---|
| Data model (35 tables) | `src/lib/db/schema.ts`, migrations in `drizzle/` (auto-applied on boot) |
| Approval gate | `src/lib/approvals.ts`, the only importer of `src/lib/outbound.ts` |
| Brand rules | `src/lib/brand.ts`. Lint runs on every draft; one-click fixes in Approvals |
| Blackout + availability | `src/lib/time.ts` (3:00–5:30 PM weekdays by default; editable in Settings) |
| Event bus / glue | `src/lib/events.ts`, `src/lib/automations.ts`, `src/lib/sequences.ts` |
| Scheduler | `src/lib/scheduler.ts`, run by `/api/cron/tick` (Vercel cron), the VPS worker, or the open app's heartbeat |
| Operator (RJ) | `src/lib/rj/` (agent tool loop, tools, morning read, her-voice drafting) |

### Non-negotiables and how they're enforced

- **UI never leaves Pamela OS.** Payments use Stripe *Embedded* Checkout on the in-app `/pay/[id]` page. Canva and Suno are driven by server-side API calls, and their results are pulled back into storage and shown in-app.
- **Every outbound action needs her approval.** Automations, sequences, RJ, the receptionist and the studios can only *create approvals*. Delivery happens in `approveAndExecute()` and nowhere else. Scheduled sends wait for both her approval and their time.
- **Brand consistency.** The full name *A Cup of Compassion* (no abbreviations), `(323) 943-ACUP`, and flat purple `#6a1b9a` are enforced by `lintBrand()` on every draft. Serif type is used for book and long-form content. Design templates lock colors and footer.
- **Blackout window.** The receptionist and booking engine both use `availableSlots()` and `overlapsBlackout()`. During blackout the receptionist takes a message, and it transfers urgent callers to 614-598-7466.
- **Full logging.** Every event is persisted (`events`), every automation run is recorded with per-step results (`automation_runs`), and every touchpoint lands on the contact timeline (`activities`). Failures show on **Automations → Run history** and on **Today**.
- **Data ownership.** There is one Postgres database, and **Settings → Your data** exports everything as JSON. Government IDs, passwords and card numbers are never stored (Stripe holds card data).

---

## Modules

| Module | Route(s) | Notes |
|---|---|---|
| Today | `/` | RJ morning read, due this week, next 3 days, receptionist, failures |
| RJ · Operator | `/rj` | Tool-calling agent over her data. Drafts land in Approvals |
| Approvals | `/approvals` | Edit, brand-fix, approve, reject, retry. Sandbox/live delivery |
| Work | `/work`, `/work/[board]` | Due-this-week dashboard, boards (drag & drop), tasks from meetings/RJ/automations |
| Contacts | `/contacts` | One record per person; relationship types (LegalShield, Board, Media, School, DR inquiry…); full timeline |
| Pipelines | `/pipelines` | Per-business-line kanban; stage changes emit events |
| Meetings | `/meetings` | Record → transcript → summary → action items → tasks + CRM notes |
| Receptionist | `/receptionist` | Twilio voice/SMS webhooks + in-app test console |
| Pages & Forms | `/funnels` | Block page builder, forms → contact + deal + sequence, payments |
| Booking | `/booking`, public `/book` | Booking types, availability, blackout-aware |
| Email & Text | `/campaigns` | Broadcasts and event-triggered sequences |
| Social & DMs | `/social` | Comment-to-DM triggers, post composer, Meta webhook |
| Video clips | `/studio/video` | Upload → transcript → scored clips with captions → render 9:16 → approve → post |
| Design | `/studio/design` | Brand-locked templates, PNG export, optional Canva Connect |
| Music | `/studio/music` | Suno generation, lyrics with RJ, release checklist |
| Her voice | `/studio/voice` | Voice clone (ElevenLabs / Chatterbox), drafts, strict approval |
| Automations | `/automations` | Builder, run history, event log, background jobs |
| Settings | `/settings` | Connections, delivery mode, brand kit, blackouts, dictionary, AI routing, export |

**Voice input everywhere:** the floating mic (or **Ctrl/⌘ + Shift + Space**) dictates into whichever field has focus. Dictation runs through her custom dictionary and an optional AI cleanup pass.

---

## Deployment

### Recommended: Vercel + Supabase + one small VPS

1. **Supabase.** Create a project. Copy the pooled connection string (port 6543) into `DATABASE_URL` and create a storage bucket `pamela-os` (private). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Migrations run automatically on first boot.
2. **Vercel.** Import the repo and set the env vars from `.env.example` (`APP_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `DATABASE_URL`, Supabase vars, `INLINE_JOBS=0`). `AUTH_SECRET` is required: a production server refuses to sign in or sign links without it. `DATABASE_URL` is effectively required too: Vercel's filesystem is read-only, so without it the embedded database falls back to a temp directory that is wiped whenever a function instance recycles (accounts and data vanish). `vercel.json` schedules `/api/cron/tick` every 5 minutes, which needs a Vercel Pro plan (Hobby allows daily crons only; on Hobby, remove the cron and let the VPS worker drive the scheduler).
3. **VPS (Hermes + worker).** On a small Linux VPS:
   - Install [Hermes Agent](https://github.com/NousResearch/hermes-agent) and enable its OpenAI-compatible API server. Put it behind HTTPS (see `deploy/Caddyfile`), then set `HERMES_BASE_URL`, `HERMES_API_KEY` and `HERMES_MODEL` in Pamela OS.
   - Clone this repo to `/opt/pamela-os`, `npm ci`, copy the same `.env`, `apt install ffmpeg`, and enable `deploy/systemd/pamela-worker.service`. The worker runs video renders, transcription, voice and music jobs and drives the scheduler.
   - Optional: a self-hosted Whisper with an OpenAI-compatible `/audio/transcriptions` endpoint → `WHISPER_URL`.
4. **Webhooks.** Paste the URLs from **Settings → Webhook URLs** into Twilio (voice + messaging on (323) 943-ACUP), Meta (Instagram/Facebook page subscriptions: `comments`, `messages`) and Stripe (`checkout.session.completed`).
5. **Install.** Open the app on her laptop and phone, then click **Install app** (or "Add to Home Screen"). Nothing else runs on her devices, and there is no Docker.

### Alternative: single VPS

Run `npm run build` and enable `deploy/systemd/pamela-web.service` + `pamela-worker.service` behind Caddy (`deploy/Caddyfile`). Point `DATABASE_URL` to Supabase or a local Postgres. If `DATABASE_URL` is omitted, the embedded database is used (single process only).

### AI providers

| Provider | Setting | Used for (default routing) |
|---|---|---|
| Hermes Agent (RJ) | `HERMES_BASE_URL`, `HERMES_API_KEY`, `HERMES_MODEL` | chat, drafting |
| Meta Model API (Muse Spark / Wonder) | `META_API_KEY`, `META_API_BASE_URL` (default `https://api.llama.com/compat/v1`), `META_MODEL` | multi-step agentic loops |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | summaries, fallback |
| ChatGPT | `OPENAI_API_KEY`, `OPENAI_MODEL` | fallback; Whisper transcription |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | fallback |

The order per kind of work is editable in **Settings → AI routing**. If a provider errors, the router falls through to the next one.

---

## Security notes

- Single owner account (scrypt password hash) and signed 30-day session cookie. All app routes are protected by middleware. Public surfaces are limited to `/p`, `/book`, `/pay`, `/api/public/*` and verified webhooks.
- Webhook signatures are verified (Twilio `X-Twilio-Signature`, Meta `X-Hub-Signature-256`, Stripe `Stripe-Signature`) when their secrets are configured.
- Media links handed to Twilio and Meta are HMAC-signed and expire.
- API keys entered in-app are encrypted with `ENCRYPTION_KEY` and never returned to the browser.
