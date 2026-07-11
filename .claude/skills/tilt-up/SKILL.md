---
name: tilt-up
description: Start the krispyai (tool / public core) local dev environment with Tilt + portless. Serves the edge Worker + embeddable widget on stable *.krispy.localhost:1355 URLs. ALWAYS use ./tilt_up.sh instead of running `tilt up` directly.
allowed-tools: Bash, Read
---

# Tilt Up — start the krispyai (tool) dev environment

**CRITICAL**: NEVER run `tilt up` directly. Always use `./tilt_up.sh`. Multiple Tilt projects run in parallel on different UI ports — a stray `tilt up` fights over the shared portless routes on `:1355` and orphans a dashboard. NEVER `kill` Tilt / portless / dev-server process groups by hand either.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai
./tilt_up.sh            # Tilt UI on http://localhost:10440
```

The script already exports the PATH portless needs (`/opt/homebrew/bin`; bun's `~/.bun/bin` is added by the Tiltfile itself), so it works from a non-interactive agent shell too. From the agent shell, run it **in the background** (it `exec`s `tilt up`, a long-running foreground process).

## Services (served roles via portless — no pinned service ports)

| Resource | URL | What |
|---|---|---|
| edge | http://edge.krispy.localhost:1355 (or http://localhost:8787) | the live-chat + human-handoff Worker (`wrangler dev`), serves `GET /health` |
| widget | http://widget.krispy.localhost:1355 (or http://localhost:3080) | the embeddable chat widget — static `index.html` + `widget.js` bundle |

Tilt UI: http://localhost:10440

## Coexisting Tilt UI ports (all share portless on `:1355`)

| Project | Tilt UI port(s) |
|---|---|
| delulus | 10370 |
| builders-stack | 10380 |
| krispyai | tool **10440** · cloud 10441 · umbrella 10442 |
| ringtail | tool 10450 · site 10451 · umbrella 10452 |

Note: envoyage-cloud currently defaults to **10441/10442** too — a known collision with krispyai cloud/umbrella. Run only one of the colliding pair at a time; they do **not** coexist cleanly.

## Pre-flight

- **portless must be up** (shared on `:1355` across all projects — `portless --version` should print). If missing: `npm install -g portless`.
- **Check for a stray krispyai Tilt first**: `curl -sf http://localhost:10440 >/dev/null && echo "already up"`. If already up, don't start another — just use the URLs. Also `ps aux | grep "[t]ilt up"` and match `--port 10440`.
- krispyai (tool) has **no database** — no `db:push`, so none of the shared-DB startup hangs that bite the delulus/cloud projects apply here.

## Checking status

```bash
tilt --port 10440 get uiresources                     # resource health
portless list                                         # active routes
curl -sf http://edge.krispy.localhost:1355/health     # edge Worker up?
```

## Teardown

`./tilt_down.sh` — kills only krispyai's tracked Tilt, never portless or other projects' Tilts. (See the `tilt-down` skill.)
