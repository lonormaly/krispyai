<div align="center">

<img src="docs/assets/hero.png" alt="Buttr, the Krispy croissant, handing a chat conversation off to a human" width="640" />

# Krispy AI 🥐

### The AI answers. You tag in.

Open-source live chat with a human handoff to Telegram — the free, self-hostable alternative to Intercom & Crisp.

**`LET THE BOT COOK 🥐`**

[![License: MIT](https://img.shields.io/badge/License-MIT-1a1c1c.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-e8552d.svg)](./CONTRIBUTING.md)
[![Built with Cloudflare Workers](https://img.shields.io/badge/built%20with-Cloudflare%20Workers-f38020.svg)](https://developers.cloudflare.com/workers/)
[![GitHub stars](https://img.shields.io/github/stars/lonormaly/krispyai?style=social)](https://github.com/lonormaly/krispyai)

</div>

---

## What it is

Krispy is open-source live chat with a human in the loop. An AI answers your visitors in your voice, and hands off to *you* on Telegram the moment a real person is needed — you reply from your phone, and it lands live in the chat while the bot goes quiet.

The paid stack for this runs **$100–400/mo** (Intercom, Crisp, a seat here, an AI add-on there). Krispy self-hosts on Cloudflare's free tier for **$0** — no per-seat tax, no login your customers never asked for, no conversations living on someone else's servers.

**This repo is the lean, self-hostable core** — exactly two deployable things and the CLI to run them:

- **`services/edge`** — the Cloudflare Worker + `SessionDO` (chat + Telegram handoff). The whole backend, one deploy.
- **`packages/widget`** — the dependency-free embeddable `widget.js`.
- **`packages/cli`** — the `krispy` CLI to manage your bot's knowledge base.

> **Buttr:** bonjour — i'm the croissant that answers your visitors so you can nap. no shade to Intercom. i'm just free.

## The loop

```
visitor ──▶ AI answers (Cloudflare Workers AI) ──▶ visitor
   │
   └──▶ one Telegram topic per visitor, on your phone
              │
   you reply in the topic ──▶ shows up LIVE in the widget
              │
              └──▶ bot goes silent — the human owns the conversation
```

- Visitor types → instant AI reply.
- Every message mirrors to **one Telegram forum topic per visitor** on your phone.
- You reply from Telegram → it's pushed into the browser over a WebSocket, **live**.
- The bot detects it's a human job and steps back — no double-answering.

Under the hood it's **one Cloudflare Worker** plus a **hibernatable Durable Object** (`SessionDO`) that holds the strongly-consistent "handed off" flag and keeps idle sockets free. That's the whole backend.

## Quickstart — self-host in ~10 minutes

You'll need [Bun](https://bun.com), a Cloudflare account (free), and a Telegram account.

```sh
git clone https://github.com/lonormaly/krispyai
cd krispyai
bun install
bun test                 # unit tests, no external services needed
bun run dev:edge         # runs the Worker on http://localhost:8787
```

`wrangler dev` binds Workers AI and the Durable Object automatically — you can drive the full loop locally before touching Telegram.

### Go live

```sh
# 1. Create the KV namespace, paste the id into services/edge/wrangler.toml (REPLACE_WITH_KV_ID)
bunx wrangler kv namespace create KRISPY_KV

# 2. Get a bot token from @BotFather (/newbot), then store it
bunx wrangler secret put TELEGRAM_BOT_TOKEN

# 3. Make a Telegram group → upgrade to supergroup → enable Topics → add your bot
#    as admin (needs "Manage Topics"). Grab the chat id (e.g. -1001234567890).
bunx wrangler secret put TELEGRAM_CHAT_ID

# 4. Pick any random string as the webhook secret
bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# 5. (Optional) a secret to gate the tenant-config route the CLI uses
bunx wrangler secret put TENANT_SYNC_SECRET

# 6. Ship it (from services/edge)
cd services/edge && bunx wrangler deploy

# 7. Point Telegram at your deployed Worker
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://krispy-edge.YOU.workers.dev/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Honest about the Telegram step: BotFather, the supergroup-with-Topics, and admin rights are a real five minutes of clicking — there's no way around a token if you want replies on your phone. Full walkthrough and architecture notes: [`services/edge/README.md`](./services/edge/README.md).

## Local dev

No Docker, no Tilt, no orchestrator — two `bun` scripts in two terminals:

```sh
bun run dev:edge      # edge Worker (wrangler dev) on http://localhost:8787
bun run dev:widget    # widget demo (bunx serve) on http://localhost:3000
```

Open the widget demo, say hi, and watch the loop. Handy checks:

```sh
bun run typecheck     # tsc over the edge Worker + CLI
bun run lint          # oxlint (Rust, fast)
bun run test          # edge unit tests + CLI smoke tests
bun run check         # typecheck + lint + test in one shot
```

## Manage your kbase — the `krispy` CLI

Your bot's knowledge base is its **system prompt**. Write it in a file, then push it into the Worker's KV — no hand-written `wrangler kv` calls:

```sh
KRISPY_API=https://krispy-edge.YOU.workers.dev \
TENANT_SYNC_SECRET=... \
  bun packages/cli/src/index.ts set-kbase ./kbase.md
```

| command | what it does |
|---------|--------------|
| `krispy set-kbase <file>` | write `<file>`'s contents as the bot's system prompt (`POST /api/tenant/config`) |
| `krispy dev` | run the edge Worker locally (`wrangler dev`) |

Config via env: `KRISPY_API` (Worker URL), `KRISPY_TENANT` (default `self`), `TENANT_SYNC_SECRET` (must match the Worker's). Details: [`packages/cli/README.md`](./packages/cli/README.md).

## Embed the widget

Host the dependency-free `widget.js` anywhere static, then drop one tag on any page. It lives in a Shadow DOM, so your site's CSS can't leak in.

```html
<script src="https://YOUR-HOST/widget.js"
        data-api="https://krispy-edge.YOU.workers.dev"
        data-tenant="self" async></script>
```

| attribute | required | default | meaning |
|-----------|----------|---------|---------|
| `data-api` | yes | — | your `@krispy/edge` Worker base URL |
| `data-tenant` | no | `self` | tenant id (multi-tenant uses this) |
| `data-title` | no | `Chat with us` | header text |
| `data-accent` | no | `#e8552d` | brand color |

Details: [`packages/widget/README.md`](./packages/widget/README.md).

## Krispy vs the others

Fair to the competition — Krispy wins on cost, openness, and lock-in, not on snark.

| | **Krispy** | Intercom | Crisp | Chatwoot |
|---|---|---|---|---|
| Open source | ✅ MIT | ❌ | ❌ | ✅ |
| Free to self-host | ✅ CF free tier, no key | ❌ | ❌ | ⚠️ run your own server |
| AI answers, built in | ✅ free (CF Workers AI) | ⚠️ paid add-on | ⚠️ paid add-on | ⚠️ BYO |
| Human handoff to *your phone* | ✅ Telegram, native | ✅ their app, paid | ✅ their app, paid | ⚠️ |
| Per-seat tax | ❌ none | ✅ $/seat | ✅ $/seat | ❌ (self-host) |

Intercom is great at being Intercom. It's just not built for a solo founder who wants to own their stack.

## Krispy Cloud — for the lazy 🥐

Don't want to touch a terminal? **[Krispy Cloud](https://krispyai.com)** is the hosted version: 14-day free trial, **$19/mo flat**, no per-seat. Same product, we run the Worker.

## Repo structure

This is the **lean, self-hostable core** — only what a user self-hosts. The dashboard, billing, accounts, and marketing surfaces live in the Cloud repo and don't ship here.

```
services/
  edge/       ⭐ the core — Cloudflare Worker + SessionDO (chat + handoff)
packages/
  widget/     ⭐ the core — dependency-free embeddable widget.js
  cli/        the `krispy` CLI — manage your kbase (system prompt)
agents/
  skills/     generic scaffolding skills (add-a-service, add-a-lib, wire-a-payment-provider)
docs/         linting · secrets · agent-skills
api-collection/  Bruno requests for the edge Worker's routes
```

Want *just* the chat? `cd services/edge`, deploy, embed `packages/widget`. That's the whole thing.

## Tech

- **Cloudflare Workers** + **Durable Objects** (hibernatable `SessionDO`) — the whole backend, one deploy.
- **Workers AI** — the built-in bot (BYO-key seam is there if you want another model).
- **Cloudflare KV** — tenant config, topic↔session map, usage counters.
- **Telegram Bot API** — the handoff channel (one forum topic per visitor).
- **Bun** + **wrangler** — package manager, runtime, deploy.
- Widget is vanilla JS in a Shadow DOM — zero framework, zero dependencies.

## Contributing

PRs welcome — this repo is a template people clone, so clarity and convention matter. Keep changes small, keep the map honest. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE). Read every line, fork it, own it.

---

<div align="center">

**à bientôt 🥐**

</div>
