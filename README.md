<div align="center">

<img src="apps/landing/public/brand/hero.png" alt="Buttr, the Krispy croissant, handing a chat conversation off to a human" width="640" />

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
cd krispyai/services/edge
bun install
bun test                 # unit tests, no external services needed
bunx wrangler dev        # runs the whole thing on http://localhost:8787
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

# 5. Ship it
bunx wrangler deploy

# 6. Point Telegram at your deployed Worker
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://krispy-edge.YOU.workers.dev/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Honest about the Telegram step: BotFather, the supergroup-with-Topics, and admin rights are a real five minutes of clicking — there's no way around a token if you want replies on your phone. Full walkthrough and architecture notes: [`services/edge/README.md`](./services/edge/README.md).

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

The self-hostable core is **`packages/widget` + `services/edge`** — those two deploy independently of everything else. The rest is the surrounding site and design system.

```
apps/
  landing/    the marketing site
  blog/       the blog (also the GEO/AI-search showcase)
  web/        the app dashboard
  mobile/     Expo starter
services/
  edge/       ⭐ the core — Cloudflare Worker + SessionDO (chat + handoff)
  api/        Hono + OpenAPI backend
  payment/    Creem / Dodo adapters
packages/
  widget/     ⭐ the core — dependency-free embeddable widget.js
libs/
  ui/         shadcn + shared design tokens + Storybook
  ...         auth, db, config, analytics, email, seo, api-types
```

Want *just* the chat? Clone the repo, `cd services/edge`, deploy, embed `packages/widget`. You can ignore the rest.

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

<img src="apps/landing/public/brand/buttr-chill.png" alt="Buttr the croissant, relaxed" width="120" />

**à bientôt 🥐**

</div>
