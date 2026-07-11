---
name: tilt-down
description: Stop the krispyai (tool / public core) Tilt dev environment cleanly. Use this instead of killing tilt/portless processes by hand.
allowed-tools: Bash, Read
---

# Tilt Down — stop the krispyai (tool) dev environment

**CRITICAL**: NEVER `kill` Tilt / portless / dev-server process groups by hand, and never run `tilt down` directly. Use `./tilt_down.sh`.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai
./tilt_down.sh
```

## What it does

- Stops **only** krispyai's tracked Tilt (its own UI on port 10440). The edge Worker + widget bundle die with it and portless auto-cleans their routes. Other projects' Tilts (10370 · 10380 · 10441 · 10442 · 10450 · …) are untouched.
- **Never** stops portless — it's the shared `:1355` proxy used by every project.

## Note on stray Tilts

`tilt_down.sh` only knows about the Tilt it started. A krispyai Tilt launched some other way (a manual `tilt up`, an old session) is untracked and survives this — check with `ps aux | grep "[t]ilt up"` and match `--port 10440` before assuming a clean slate.
