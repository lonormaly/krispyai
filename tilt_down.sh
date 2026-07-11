#!/usr/bin/env bash
# Stop the krispyai (tool / public core) Tilt cockpit. The served roles (edge
# Worker + widget bundle) die with Tilt, which auto-cleans their portless routes.
# The shared portless proxy (port 1355) keeps running for other projects — stop
# it manually with `portless proxy stop` if you really need to.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
TILT_PORT="${TILT_PORT:-10440}"

tilt down --port "$TILT_PORT" 2>/dev/null || tilt down 2>/dev/null || true
echo "→ krispyai (tool): stopped"
