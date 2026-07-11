#!/usr/bin/env bash
# Headless deploy for the krispy public core. Shared by the Tilt deploy:* resources
# (DRY — Tilt calls this, it isn't a second copy) and by a human on the command line.
#
#   ./deploy.sh <edge|docs|widget> <preview|production>
#
# Every deploy: preflight (creds present) → build (if any) → wrangler deploy → smoke.
# Cloudflare creds come from the Infisical-fed .env.local (docs/secrets.md) — never
# hardcoded, never in GitHub. Deploy is Tilt + wrangler, NOT GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-}"
ENV="${2:-}"
case "$TARGET" in edge | docs | widget) ;; *) echo "usage: ./deploy.sh <edge|docs|widget> <preview|production>" >&2; exit 2 ;; esac
case "$ENV" in preview | production) ;; *) echo "usage: ./deploy.sh <edge|docs|widget> <preview|production>" >&2; exit 2 ;; esac

# Source Infisical-fed creds. `set -a` exports every var so wrangler + child scripts see them.
set -a
[ -f .env.local ] && . .env.local
set +a

BUN="${BUN:-bun}"

# 1) Preflight — assert CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (blocks on missing).
node scripts/cf-deploy-preflight.mjs "$ENV"

# The deployed base URL to smoke. Prod defaults to the krispyai.com custom domains
# (attached in the CF dashboard after first deploy — see AGENTS.md §11). Override any
# via .env.local: EDGE_PRODUCTION_URL / DOCS_PRODUCTION_URL / WIDGET_*_URL, etc.
# Preview has no default (workers.dev/pages.dev URL differs per account) — set it to smoke.
url_for() {
  local t="$1" e="$2" var
  var="$(echo "${t}_${e}_URL" | tr '[:lower:]' '[:upper:]')"
  if [ -n "${!var:-}" ]; then echo "${!var}"; return; fi
  [ "$e" = production ] && case "$t" in
    edge) echo "https://edge.krispyai.com" ;;
    docs) echo "https://docs.krispyai.com" ;;
    widget) echo "https://widget.krispyai.com" ;;
  esac
}

case "$TARGET" in
  edge)
    echo "→ deploy edge ($ENV)"
    ( cd services/edge && "$BUN" x wrangler deploy --env "$ENV" )
    SMOKE_KIND=edge
    ;;
  docs)
    echo "→ deploy docs ($ENV)"
    if [ ! -f apps/docs/package.json ]; then
      echo "✘ apps/docs not present on this ref — cannot deploy docs." >&2; exit 1
    fi
    # apps/docs is a Fumadocs app that fully static-exports (`output: 'export'` →
    # `out/`). All routes are SSG and search is a build-time Orama index (static
    # client), so there's NO Node/edge runtime and NO next-on-pages — we just
    # `next build` and upload `out/` to CF Pages, exactly like the widget target.
    ( cd apps/docs && "$BUN" install --frozen-lockfile \
        && "$BUN" run build \
        && "$BUN" x wrangler pages deploy out \
             --project-name "krispy-docs-${ENV}" \
             --branch "$([ "$ENV" = production ] && echo main || echo preview)" )
    SMOKE_KIND=pages
    ;;
  widget)
    echo "→ deploy widget ($ENV)"
    # The widget is a static bundle (no build step) — deploy the dir as-is.
    "$BUN" x wrangler pages deploy packages/widget \
      --project-name "krispy-widget-${ENV}" --branch "$([ "$ENV" = production ] && echo main || echo preview)"
    SMOKE_KIND=pages
    ;;
esac

# 3) Smoke — curl the live URL if we know it. Skipped (with a warning) when unset,
# so a first deploy before you've recorded the URL doesn't hard-fail.
SMOKE_URL="$(url_for "$TARGET" "$ENV")"
if [ -n "$SMOKE_URL" ]; then
  node scripts/cf-deploy-smoke.mjs "$SMOKE_KIND" "$SMOKE_URL"
else
  echo "⚠ smoke skipped — set $(echo "${TARGET}_${ENV}_URL" | tr '[:lower:]' '[:upper:]') in .env.local to enable the post-deploy check."
fi

echo "✔ deploy done: $TARGET ($ENV)"
