# CLAUDE.md — the map for coding agents

This is the **lean, self-hostable core** of Krispy — a bun-workspace repo with two deployable surfaces plus a CLI. Read this before writing code; it tells you where everything lives so you don't reinvent what already exists. The full operating guide is [`AGENTS.md`](./AGENTS.md); this is the short mirror.

## Where things live

- `services/edge` — ⭐ the core Cloudflare Worker + `SessionDO` (chat + Telegram handoff). Self-contained: no `@krispy/*` runtime imports; CF globals hand-declared in `src/cf.d.ts`.
- `packages/widget` — ⭐ the dependency-free embeddable `widget.js` (vanilla JS in a Shadow DOM).
- `packages/cli` — the `krispy` CLI (`set-kbase`, `dev`) — manage the bot's system prompt via the Worker's `/api/tenant/config` route.
- `agents/skills` — generic scaffolding skills. `docs/` — linting · secrets · agent-skills. `api-collection/` — Bruno requests for the Worker.

The dashboard, billing, accounts, and marketing live in a separate Cloud repo — not here.

## Conventions (do not break)

- **No hardcoded URLs/ports/secrets.** Worker secrets (`TELEGRAM_*`, `TENANT_SYNC_SECRET`) live in Cloudflare (`wrangler secret put`). The CLI reads env (`KRISPY_API`, `KRISPY_TENANT`, `TENANT_SYNC_SECRET`) — see `.env.example`.
- **The widget stays dependency-free** — vanilla JS, no framework, no bundler, no npm deps.
- **The edge Worker stays self-contained** — don't add a lib dependency; it's a clean single deploy.
- Every workspace extends the root `tsconfig.base.json`. Don't fork compiler options.

## How to run

No Tilt, no Docker, no orchestrator — two `bun` scripts in two terminals:

- `bun install`, then `bun run dev:edge` (Worker on :8787) and `bun run dev:widget` (demo on :3000).
- Checks: `bun run typecheck` · `bun run lint` (oxlint) · `bun run test` · `bun run check` (all three).
- Deploy the Worker from `services/edge` with `bunx wrangler deploy`.

## Adding things

- New shared code used in 2+ places → a `packages/*` package with a `src/index.ts`.
- New thing that needs its own URL/deploy → a `services/*`. Skills in `agents/skills/` scaffold these when you grow the repo back out.

## How to work here (hard-won)

- **Secrets:** local dev = `.env.local` (git-ignored; never commit); `.env.example` documents every key. Worker secrets go in Cloudflare via `wrangler secret put`, never in the repo. See `docs/secrets.md`.
- **Parallel agents:** isolate every file-touching agent in its own git worktree/branch — never two agents on the same checkout, or they overwrite each other.
- **Push, don't poll:** for job/status state use WebSocket/SSE, not a `setInterval` hitting an endpoint. An idle client makes zero requests. (The Worker's handoff already pushes over the `SessionDO` WebSocket.)
- **Sacred content:** never delete the instructional comments in `agents/`, skills, or configs — restructure/add, don't strip. They're hard-won.
- **Keep Bruno in sync:** a change to an edge route (new endpoint, changed shape, new error code, auth change) must update the matching `.bru` in `api-collection/` in the same change.
- **DOCUMENTATION SYNC:** any change to behavior, API surface, config/env vars, or CLI flags is **incomplete** until the matching Fumadocs page under `apps/docs/content/docs/**`, the touched README section, and a `CHANGELOG.md` `[Unreleased]` entry (Keep-a-Changelog: Added/Changed/Fixed/Removed) ship **in the same PR/commit**. Full routing map: `AGENTS.md` §7.
- **Third-party skills/MCPs — vet before you install:** a skill/MCP is code with your permissions + a payload the model obeys (the reason we swapped the SQL-injectable Postgres MCP for a read-only one). Before installing an unfamiliar one: **(1)** scan — `./scripts/scan-skill.sh <name>` (Clawdex; `malicious`→stop, `unknown`→manual review); **(2)** read the actual `SKILL.md` + every bundled script/hook, not the README (reject prompt-injection, phone-home URLs, `curl | sh`); **(3)** check `allowed-tools` + hooks (auto-execute = highest risk); **(4)** check provenance (official > brand-new; aggregator installers untrusted); **(5)** prefer first-party, pin a commit. Full law + curated recommended list: [`docs/agent-skills.md`](./docs/agent-skills.md).

## Compliance — enabled gates

- **secrets scanned in CI** — `gitleaks` (`.gitleaks.toml`) fails the build on a committed secret.
- **deps scanned** — `osv-scanner` CI job on every PR.

See `agents/` for skills and MCP config.
