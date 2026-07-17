# @krispyai/cli

The `krispy` self-host CLI — manage your bot's knowledge base (its system prompt)
without hand-writing `wrangler kv` calls. It talks to your [`@krispy/edge`](../../services/edge)
Worker's `POST /api/tenant/config` route, which merges the prompt into KV.

## Commands

```sh
krispy init                  # guided first-run setup (Telegram → train → embed → next steps)
krispy set-kbase kbase.md    # write kbase.md as the bot's system prompt
krispy logo logo.png         # remove a logo's bg locally → paste-ready avatar data URI
krispy kb-suggestions        # list pending relearning suggestions (the approval inbox)
krispy kb-approve <id>       # approve a suggestion → add it to the bot's kbase
krispy kb-dismiss <id>       # dismiss a suggestion
krispy dev                   # run the edge Worker locally (wrangler dev)
```

### `krispy kb-suggestions` / `kb-approve` / `kb-dismiss` — the relearning approval inbox

When a handed-off session hands back to the AI and a human had answered something the bot
couldn't, the edge proposes a `Q→A` **suggestion**. Nothing reaches the bot's knowledge until
you approve it (human-in-the-loop by design — a visitor can't poison the KB). These are the
self-host counterpart to Krispy Cloud's `/knowledge` inbox, over the same secret-authed routes:

```sh
krispy kb-suggestions          # list pending suggestions (id + Q + A)
krispy kb-approve sug_abc123   # append it to kbSources (+ bump kbVersion), drop it
krispy kb-dismiss  sug_abc123  # drop it, no KB change
```

Each command scopes to the tenant's default site; pass `--site <id>` (→ `?s=` / `siteId`) to
target a specific site. All three require `TENANT_SYNC_SECRET`. `kb-approve` on an unknown id
prints a clear error and exits non-zero.

### `krispy logo <file>` — local background removal

The self-host counterpart to Krispy Cloud's AI logo bg-removal — but fully local: no cloud
call, no API key. It removes the background with a **corner chroma-key** (samples the four
corners; if they agree on one background color, flood-fills that region to transparent) and
prints a ready-to-paste `data:image/png;base64,…` avatar URI:

```sh
krispy logo ./logo.png | pbcopy     # the data URI is the only thing on stdout
```

Then paste it as `theme.avatar` in your tenant config (the dashboard, or a
`POST /api/tenant/config` body) — the widget renders it in both the header and the launcher
badge. Accepts `.png/.jpg/.jpeg/.webp/.svg`; downscales to 144px (~5–30KB). An
already-transparent image (SVG / transparent PNG) passes through untouched, and a photographic
/ busy background it can't cleanly key is kept as-is — background removal never mangles a logo.

Corner chroma-key is the documented floor: it excels at logos on a flat background. The upgrade
path is local ONNX segmentation (modnet) if arbitrary backgrounds become worth a large model
download. This command depends on `sharp` (lazy-loaded, so the CLI core stays dep-free).

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

| var                  | default                 | meaning                                      |
| -------------------- | ----------------------- | -------------------------------------------- |
| `KRISPY_API`         | `http://localhost:8787` | your edge Worker base URL                    |
| `KRISPY_TENANT`      | `self`                  | tenant id                                    |
| `TENANT_SYNC_SECRET` | —                       | must match the Worker's `TENANT_SYNC_SECRET` |

## Run it

```sh
# from the repo (no publish needed):
KRISPY_API=https://krispy-edge.YOU.workers.dev \
TENANT_SYNC_SECRET=... \
  bun packages/cli/src/index.ts set-kbase ./kbase.md
```
