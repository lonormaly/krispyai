---
name: dev-up
description: Start the krispyai umbrella (tool + cloud) — one Tilt that boots BOTH repos together on UI port 10442. The umbrella scripts live in krispyai-cloud. ALWAYS use ./dev_up.sh, never `tilt up` directly.
allowed-tools: Bash, Read
---

# Dev Up — start the krispyai umbrella (tool + cloud)

`dev_*` is the **whole-stack umbrella**: one Tilt that serves the public core / tool (edge + widget) *and* the cloud stack (web · api · landing · blog · payment · storybook) together. The umbrella scripts live in **krispyai-cloud** (`dev.Tiltfile` `include()`s the tool's Tiltfile via the sibling path `../krispyai`), so this skill `cd`s there.

**CRITICAL**: NEVER run `tilt up` directly and NEVER `kill` Tilt / portless by hand. Always use `./dev_up.sh`. Multiple Tilt projects share portless on `:1355` — a stray `tilt up` fights over portless routes and orphans a dashboard.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai-cloud
./dev_up.sh            # Tilt UI on http://localhost:10442
```

The script exports the PATH portless needs (`/opt/homebrew/bin`; bun's `~/.bun/bin` is added by the Tiltfile itself), so it works from a non-interactive agent shell. It `exec`s a long-running `tilt up -f dev.Tiltfile` — from the agent shell run it **in the background**.

## Services (served roles via portless — no pinned service ports)

| Resource | URL | What |
|---|---|---|
| edge | http://edge.krispy.localhost:1355 (or :8787) | tool — live-chat + handoff Worker, `GET /health` |
| widget | http://widget.krispy.localhost:1355 (or :3080) | tool — embeddable chat widget bundle |
| web | http://web.krispy.localhost:1355 (or http://localhost:5747) | cloud — Next.js dashboard (fixed port, OAuth-ready) |
| api | http://api.krispy.localhost:1355 (or http://localhost:5748) | cloud — Hono + OpenAPI + Better Auth, `/health` |
| landing | http://landing.krispy.localhost:1355 | cloud — public marketing site |
| blog | http://blog.krispy.localhost:1355 | cloud — public SSG MDX blog |
| payment | http://payment.krispy.localhost:1355 | cloud — Merchant-of-Record billing, `/health` |
| storybook | http://storybook.krispy.localhost:1355 | cloud — `@krispy/ui` design system |

Tilt UI: http://localhost:10442

## Coexisting Tilt UI ports (all share portless on `:1355`)

| Project | Tilt UI port(s) |
|---|---|
| delulus | 10370 |
| builders-stack | 10380 |
| krispyai | tool 10440 · cloud 10441 · umbrella **10442** |
| ringtail | tool 10450 · site 10451 · umbrella 10452 |

Note: envoyage-cloud and its umbrella now run on their own UI ports (**10461** / **10462**) — no conflict with krispyai.

## Pre-flight

- **`../krispyai` must exist as a sibling checkout** — the umbrella `include()`s the tool's Tiltfile by relative path; the two repos MUST stay siblings inside `krispyai-org/`. If it's missing, `dev.Tiltfile` prints a warning and boots the cloud stack alone.
- **portless must be up** (shared on `:1355` — `portless --version` should print). If missing: `npm install -g portless`.
- **Check for a stray umbrella Tilt first**: `ps aux | grep "[t]ilt up"` matching `--port 10442`; don't start a second.

## Database note (the cloud half has a database)

The cloud stack talks to a database (`@krispy/db`, `DATABASE_URL` from `.env.local`). **The umbrella does NOT push schema on boot** — `db:push` is a manual click-to-run Tilt button (`auto_init=False`), not a boot step, so booting won't hang on a schema prompt. If you click `db:push` (or run `@krispy/db push`) **manually** against a shared local DB, mind the usual caution: an unexpected **DROP** prompt means the DB has tables this checkout's schema doesn't — reconcile before confirming. The tool half has no database.

## Teardown

`./dev_down.sh` (in krispyai-cloud) — stops the umbrella, which covers both the tool and the cloud. (See the `dev-down` skill.)
