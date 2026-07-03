# @krispy/cli

The `krispy` self-host CLI — manage your bot's knowledge base (its system prompt)
without hand-writing `wrangler kv` calls. It talks to your [`@krispy/edge`](../../services/edge)
Worker's `POST /api/tenant/config` route, which merges the prompt into KV.

## Commands

```sh
krispy init                  # guided first-run setup (Telegram → train → embed → next steps)
krispy set-kbase kbase.md    # write kbase.md as the bot's system prompt
krispy dev                   # run the edge Worker locally (wrangler dev)
```

### `krispy init` — the wizard

The terminal-native counterpart to Krispy Cloud's dashboard onboarding. Four steps, each
persisted as you go via `POST /api/tenant/config` (single-tenant `self`); re-run any time —
it never clobbers fields you've already set.

1. **Connect Telegram** — BotFather guide (`/newbot` at <https://t.me/botfather>) → paste the
   bot token, **validated live via Telegram `getMe`** (green `✓ @yourbot` or red retry) →
   supergroup-with-Topics + add-the-bot-as-admin guide → chat id. Persists `botToken` + `chatId`.
2. **Train your bot** — point it at a knowledge-base file, accept a starter template, or skip
   (set one later with `set-kbase`). Persists `systemPrompt`.
3. **Embed the widget** — prints the copy-paste `<script>` snippet with your `data-api` +
   `data-tenant` baked in. Paste it before `</body>`.
4. **Next steps** — how to run (`krispy dev` / `wrangler deploy`) and test the loop.

Needs a real terminal (TTY); in CI/piped input it exits with guidance instead of hanging.

## Config (env)

| var | default | meaning |
|-----|---------|---------|
| `KRISPY_API` | `http://localhost:8787` | your edge Worker base URL |
| `KRISPY_TENANT` | `self` | tenant id |
| `TENANT_SYNC_SECRET` | — | must match the Worker's `TENANT_SYNC_SECRET` |

## Run it

```sh
# from the repo (no publish needed):
KRISPY_API=https://krispy-edge.YOU.workers.dev \
TENANT_SYNC_SECRET=... \
  bun packages/cli/src/index.ts set-kbase ./kbase.md
```
