# krispyai (public core) — Tilt entrypoint.  Boot with:  ./tilt_up.sh
# (never `tilt up` directly — the script pins Tilt UI port 10440 so multiple
# projects coexist).
#
# Real logic lives in .devops/Tiltfile. Served roles get stable named URLs via
# Vercel Portless: <service>.krispy.localhost:1355 — no pinned service ports.

load_dynamic('.devops/Tiltfile')

# =============================================================================
# Dashboard "title" — Tilt has no native project-title setting, so a banner
# resource in a digit-prefixed label group (Tilt sorts groups case-insensitively,
# so a leading digit is the only thing that sorts above the alphabet) headlines
# the sidebar with the project name. Cosmetic, zero-cost. Gated to the entry
# Tiltfile so it doesn't double up when the cloud umbrella include()s this one.
# =============================================================================
if config.main_path == os.path.abspath('Tiltfile'):
    local_resource(
        'KRISPY-CORE',
        cmd='echo "🥐 KrispyAI (public core) — dev dashboard · ./tilt_up.sh · UI :10440"',
        labels=['0-KRISPY-CORE'],
    )
