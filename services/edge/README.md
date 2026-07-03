# @krispy/edge

The live-chat + human-handoff backend. **One Cloudflare Worker** hosts both the
`/api/*` routes and the `SessionDO` Durable Object — a single deploy, one
`wrangler.toml`, runnable end-to-end under `wrangler dev`.

> Design note: the brief said "Pages Functions + a Worker/DO". There's no static
> site to host here (the widget embeds on the *customer's* site) and a DO must live
> in a Worker regardless, so a lone Worker is strictly simpler — fewer moving parts,
> one origin, no Pages↔Worker binding dance. The route layout maps 1:1 to Pages
> Functions if you ever want to split them.

## The loop

```
visitor ──POST /api/chat──▶ Worker ──▶ Workers AI ──▶ reply ──▶ visitor
                              │
                              └─▶ Telegram: one forum TOPIC per visitor (owner's phone)
owner replies in topic ──POST /api/telegram/webhook──▶ Worker
                              │
                              └─▶ SessionDO ──WebSocket──▶ visitor's browser (live)
                                             + set handedOff=true → AI goes silent
```

## Endpoints

| method | path | purpose |
|--------|------|---------|
| POST | `/api/chat` | `{sessionId, message, tenantId?, history?}` → `{reply, handoff, handedOff, degraded?}` |
| POST | `/api/contact` | `[!HANDOFF]` contact-capture → owner's topic |
| POST | `/api/telegram/webhook` | owner reply → push to visitor via DO |
| POST | `/api/billing/entitlement` | billing → gate: mirror an entitlement snapshot into KV *(secret-guarded)* |
| GET | `/api/tenant/config?t=<tenant>` | dashboard → read a tenant's config `{botToken, chatId, systemPrompt?, model?}`, 404 if none *(secret-guarded)* |
| POST | `/api/tenant/config` | dashboard → `{tenantId, config}` merge into the tenant's KV config *(secret-guarded)* |
| GET | `/api/session/:id/ws?t=<tenant>` | visitor's live channel (WebSocket → DO) |
| GET | `/api/usage?t=<tenant>` | metering + plan readout (`usage` also carries approx `tokens`) |
| GET | `/health` | liveness |

### Cost knobs — the "turn tax"

Each chat turn re-sends the whole history to the LLM, so naive cost grows quadratically
with conversation length. Three bounds (all optional env vars; code defaults shown) keep
per-turn cost flat, without changing product behavior on normal short chats:

| env var | default | why |
|---------|---------|-----|
| `MAX_HISTORY_MSGS` | `8` | Sliding window — the AI only sees the last N prior messages (system + latest user always kept, oldest turns trimmed). Caps the input that grows every turn. |
| `MAX_OUTPUT_TOKENS` | `256` | Hard cap on reply length (output tokens are ~4–5× the price of input). A brevity line is also appended to the system prompt so the cap rarely bites. |
| `MAX_AI_TURNS` | `10` | After N AI turns in a session with no resolution, hand off to a human instead of paying for another (likely-looping) turn — cost *and* UX. Generous: short chats never hit it. |

Metering now also tracks approximate tokens (`chars/4` estimate, since Workers AI's
response exposes no usage counts) under the `usage:<tenant>:<yyyymm>:tokens` KV counter,
surfaced as `tokens` in `/api/usage`. Prompt caching is N/A on Workers AI (no
`cache_control` knob); the BYO-key adapter seam in `ai.ts` is where it plugs in later.

### Tenant-config sync (dashboard → gate)

The Krispy Cloud dashboard (`apps/web`) manages a tenant's Telegram creds + prompt/
model over `/api/tenant/config`. Both routes require the header
`x-tenant-sync-secret: <TENANT_SYNC_SECRET>` — the payload holds a **bot token**, so
without the secret they return **401** and never leak config. POST **merges** (unset
fields are preserved), writing the exact KV shape `getTenant()` reads (key
`tenant:<tenantId>`), so a saved bot token/prompt immediately drives the bot.

Secrets are separate on purpose: `BILLING_SYNC_SECRET` guards the billing→gate push,
`TENANT_SYNC_SECRET` guards the dashboard→config sync. Set both with
`bunx wrangler secret put <NAME>`.

## Architecture

- **`SessionDO`** — one per `(tenantId, sessionId)`. Uses `state.acceptWebSocket()`
  (hibernation) so idle sockets cost **nothing**. Holds the strongly-consistent
  `handedOff` flag (KV is too eventually-consistent for an instant bot-silence switch).
- **KV (`KRISPY_KV`)** — topic↔session map (`thread:`/`session:`), tenant config
  (`tenant:`), usage counters (`usage:<tenant>:<yyyymm>:<kind>`).
- **`tenantId`** — default `"self"` (single-tenant self-host, config from secrets);
  any other id reads config from KV. Same code path both ways.
- **Metering** — every AI call + handoff increments a KV counter; `planFor()` /
  `withinPlan()` are the plan-gate seam (unlimited for `self` today).
- **Graceful degradation** — AI down → still hands off to a human (never drops the
  visitor); Telegram unconfigured → chat still answers, topic ops no-op.
- **AI adapter** — Workers AI default (`workersAiRunner`); the `AiRunner` type is the
  BYO-key seam.

## Run locally

```sh
cd services/edge
bun test                 # unit tests (no external services needed)
bunx wrangler dev        # serves on http://localhost:8787
```

`wrangler dev` binds Workers AI + the DO automatically. KV needs a namespace id in
`wrangler.toml` (see below); for a pure local run `wrangler dev --local` uses a
simulated KV.

## Go fully live (service-gated steps)

1. **KV namespace** — `bunx wrangler kv namespace create KRISPY_KV`, paste the id
   into `wrangler.toml` (`REPLACE_WITH_KV_ID`).
2. **Telegram bot** — talk to [@BotFather](https://t.me/BotFather) → `/newbot` →
   copy the token. Then `bunx wrangler secret put TELEGRAM_BOT_TOKEN`.
3. **Supergroup with Topics** — create a Telegram group, upgrade it to a supergroup,
   enable **Topics** in group settings, add your bot as an **admin** (needs *Manage
   Topics*). Get the chat id (e.g. via [@RawDataBot], looks like `-1001234567890`) →
   `bunx wrangler secret put TELEGRAM_CHAT_ID`.
4. **Webhook secret** — pick a random string →
   `bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
5. **Deploy** — `bunx wrangler deploy`.
6. **Register the webhook** with Telegram (points it at the deployed Worker):
   ```sh
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://krispy-edge.YOU.workers.dev/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
7. **Embed the widget** (see [`packages/widget`](../../packages/widget)) with
   `data-api="https://krispy-edge.YOU.workers.dev"`.

That's it — a visitor message now opens a topic on your phone, and your reply from
Telegram appears live in their browser with the AI silenced.
