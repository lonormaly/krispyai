---
name: tilt-restart
description: Restart the krispyai (tool / public core) Tilt dev environment — down then up on the same UI port (10440). Use this to pick up dependency or Tiltfile/config changes cleanly. ALWAYS use the scripts, never `tilt down`/`tilt up` directly.
allowed-tools: Bash, Read
---

# Tilt Restart — restart the krispyai (tool) dev environment

**CRITICAL**: NEVER run `tilt down` / `tilt up` directly and NEVER `kill` Tilt / portless / dev-server process groups by hand. Always go through the scripts. Multiple Tilt projects share portless on `:1355` — a stray `tilt up` fights over portless routes and orphans a dashboard.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai
./tilt_down.sh && ./tilt_up.sh     # same UI port 10440
```

Both scripts already export the PATH portless needs (`/opt/homebrew/bin`; bun's `~/.bun/bin` is added by the Tiltfile itself), so they work from a non-interactive agent shell. `tilt_up.sh` `exec`s `tilt up` (a long-running foreground process) — from the agent shell run the pair **in the background**.

## When to use

The clean way to pick up **dependency or Tiltfile/config changes** — a plain live edit won't reload them. A restart tears the edge Worker + widget down and brings them back on the same routes.

## Coexisting Tilt UI ports (all share portless on `:1355`)

| Project | Tilt UI port(s) |
|---|---|
| delulus | 10370 |
| builders-stack | 10380 |
| krispyai | tool **10440** · cloud 10441 · umbrella 10442 |
| ringtail | tool 10450 · site 10451 · umbrella 10452 |

Note: envoyage-cloud and its umbrella now run on their own UI ports (**10461** / **10462**) — no conflict with krispyai.

## Note on stray Tilts

`tilt_down.sh` only stops the Tilt it started. A krispyai tool Tilt launched some other way (a manual `tilt up`, an old session) is **untracked** and survives the down step — so the restart can leave two Tilts fighting over port 10440. Check first with `ps aux | grep "[t]ilt up"` and match `--port 10440`.

- krispyai (tool) has **no database** — no `db:push`, so none of the shared-DB startup hangs that bite the delulus/cloud projects apply here.
