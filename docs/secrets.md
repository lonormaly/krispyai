# Secrets in krispyai

Never commit real secrets. Two kinds of config live in this repo's world:

- **The edge Worker's secrets** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TENANT_SYNC_SECRET`. These live in **Cloudflare**, not in any file.
- **The `krispy` CLI's config** — `KRISPY_API`, `KRISPY_TENANT`, `TENANT_SYNC_SECRET`. Documented in `.env.example`; put your fill-ins in `.env.local` (git-ignored).

## 1. Worker secrets — `wrangler secret put`

The Worker never reads a `.env` file at runtime; set each secret in Cloudflare:

```bash
cd services/edge
bunx wrangler secret put TELEGRAM_BOT_TOKEN
bunx wrangler secret put TELEGRAM_CHAT_ID
bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET
bunx wrangler secret put TENANT_SYNC_SECRET     # optional: gates /api/tenant/config
```

Local `wrangler dev` reads them from a git-ignored `.dev.vars` in `services/edge` if you want to iterate without deploying.

## 2. CLI config — `.env.local`

Copy `.env.example` → `.env.local`, fill it in. Keep it clean — **strip inline comments** (an unstripped comment can corrupt a value). Only `TENANT_SYNC_SECRET` is a real secret here, and it must match the Worker's.

## 3. Team + prod — [Infisical](https://infisical.com) (optional)

Once more than one person or machine needs the secrets, make **Infisical** (open-source secrets manager) the single source of truth — no secret ever lives in a committed file, and every environment pulls from one place. It pushes to Cloudflare Workers via the [native Cloudflare connector](https://infisical.com/docs/integrations/cloud/cloudflare-pages), so you never hand-copy a secret into the platform.

## Rules

- **Bindings are not secrets** (KV, Durable Objects) — they live in `wrangler.toml` / the Cloudflare project config, never in Infisical.
- One source of truth per environment; prefer the Infisical sync over per-platform `secret put` once you have more than one machine (hand-set `secret put` drifts).
