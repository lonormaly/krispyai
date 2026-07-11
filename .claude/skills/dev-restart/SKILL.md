---
name: dev-restart
description: Restart the krispyai umbrella (tool + cloud) — down then up on the same UI port (10442). The umbrella scripts live in krispyai-cloud. Use this to pick up dependency/config changes across the whole stack. ALWAYS use the scripts, never `tilt up`/`tilt down` directly.
allowed-tools: Bash, Read
---

# Dev Restart — restart the krispyai umbrella (tool + cloud)

`dev_*` is the **whole-stack umbrella** (tool + cloud in one Tilt, UI port **10442**). Its scripts live in **krispyai-cloud**, so this skill `cd`s there.

**CRITICAL**: NEVER run `tilt down` / `tilt up` directly and NEVER `kill` Tilt / portless / dev-server process groups by hand. Always go through the scripts. Multiple Tilt projects share portless on `:1355` — a stray `tilt up` fights over portless routes and orphans a dashboard.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai-cloud
./dev_down.sh && ./dev_up.sh       # same UI port 10442
```

Both scripts export the PATH portless needs (`/opt/homebrew/bin`; bun's `~/.bun/bin` is added by the Tiltfile itself), so they work from a non-interactive agent shell. `dev_up.sh` `exec`s a long-running `tilt up -f dev.Tiltfile` — from the agent shell run the pair **in the background**.

## When to use

The clean way to pick up **dependency or Tiltfile/config changes** across the whole stack — a plain live edit won't reload them. A restart tears both the tool and the cloud down and brings them back on the same routes.

## Coexisting Tilt UI ports (all share portless on `:1355`)

| Project | Tilt UI port(s) |
|---|---|
| delulus | 10370 |
| builders-stack | 10380 |
| krispyai | tool 10440 · cloud 10441 · umbrella **10442** |
| ringtail | tool 10450 · site 10451 · umbrella 10452 |

Note: envoyage-cloud and its umbrella now run on their own UI ports (**10461** / **10462**) — no conflict with krispyai.

## Pre-flight & stray Tilts

- **`../krispyai` must exist as a sibling checkout** — the umbrella `include()`s the tool's Tiltfile by relative path; keep both repos siblings inside `krispyai-org/`.
- **portless must be up** (shared on `:1355`). If missing: `npm install -g portless`.
- `dev_down.sh` only stops the Tilt `dev_up.sh` started. An umbrella Tilt launched some other way is **untracked** and survives the down step, leaving two Tilts fighting over port 10442 — check first with `ps aux | grep "[t]ilt up"` and match `--port 10442`.

## Database note (the cloud half has a database)

The cloud stack has a database (`@krispy/db`), but a restart does **not** push schema — `db:push` is a manual Tilt button (`auto_init=False`), not a boot step, so a restart won't hang on a schema prompt. If you run `db:push` (`@krispy/db push`) **manually** against a shared local DB, mind the usual caution: an unexpected **DROP** prompt means reconcile first. The tool half has no database.
