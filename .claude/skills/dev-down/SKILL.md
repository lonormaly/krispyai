---
name: dev-down
description: Stop the krispyai umbrella (tool + cloud) cleanly — one Tilt on UI port 10442 that covers BOTH repos. The umbrella scripts live in krispyai-cloud. Use this instead of killing tilt/portless by hand.
allowed-tools: Bash, Read
---

# Dev Down — stop the krispyai umbrella (tool + cloud)

`dev_*` is the **whole-stack umbrella** (tool + cloud in one Tilt). Its scripts live in **krispyai-cloud**, so this skill `cd`s there.

**CRITICAL**: NEVER `kill` Tilt / portless / dev-server process groups by hand, and never run `tilt down` directly. Use `./dev_down.sh`.

## Usage

```bash
cd ~/Development/krispyai-org/krispyai-cloud
./dev_down.sh
```

## What it does

- Stops the umbrella's tracked Tilt (its UI on port **10442**), which brings down **both** the tool and the cloud together. Other projects' Tilts (10370/10380/10450/…) and the standalone 10440/10441 Tilts are untouched.
- **Never** stops portless — it's the shared `:1355` proxy used by every project.

## Note on stray Tilts

`dev_down.sh` only knows the Tilt `dev_up.sh` started. An umbrella Tilt launched some other way (a manual `tilt up -f dev.Tiltfile`, an old session) is **untracked** and survives this — check with `ps aux | grep "[t]ilt up"` and match `--port 10442` before assuming a clean slate.
