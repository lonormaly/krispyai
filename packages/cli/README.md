# @krispy/cli

The `krispy` self-host CLI — manage your bot's knowledge base (its system prompt)
without hand-writing `wrangler kv` calls. It talks to your [`@krispy/edge`](../../services/edge)
Worker's `POST /api/tenant/config` route, which merges the prompt into KV.

## Commands

```sh
krispy set-kbase kbase.md    # write kbase.md as the bot's system prompt
krispy dev                   # run the edge Worker locally (wrangler dev)
```

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
