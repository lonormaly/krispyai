# AGENTS.md — the primer for coding agents

Cross-tool guide for any AI coding agent working in this repo (Claude Code, Cursor, Codex, Copilot, Windsurf, …).
Codex, Cursor, and Copilot read a repo-root `AGENTS.md` by convention — **this file is the source of truth.** Claude Code also reads [`CLAUDE.md`](./CLAUDE.md); Cursor reads [`.cursor/rules.md`](./.cursor/rules.md). Both are short mirrors that point back here.

Read this **before writing code**. It tells you where everything lives so you don't reinvent what already exists.

---

## 1. What this repo is

This is the **lean, self-hostable core** of Krispy — open-source live chat with an AI answerer and a human handoff to Telegram. Only what a user self-hosts ships here. The dashboard, billing, accounts, and marketing surfaces live in a separate Cloud repo and are **not** in this tree.

There are exactly **two deployable things** plus the CLI to run them:

| Path              | What it is                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/edge`   | ⭐ the core — one Cloudflare Worker + a hibernatable Durable Object (`SessionDO`). Chat + Telegram handoff. The whole backend, one deploy. |
| `packages/widget` | ⭐ the core — the dependency-free embeddable `widget.js` (vanilla JS in a Shadow DOM, zero deps).                                          |
| `packages/cli`    | the `krispy` CLI — manage your bot's knowledge base (its system prompt) via the Worker's tenant-config route.                              |

Supporting: `agents/skills/` (generic scaffolding skills), `docs/` (linting · secrets · agent-skills), `api-collection/` (Bruno requests for the edge Worker's routes).

## 2. The map

```
krispyai/
├── services/
│   └── edge/        @krispy/edge   Cloudflare Worker + SessionDO — POST /api/chat, /api/contact,
│                                   /api/telegram/webhook, /api/tenant/config, GET /api/usage, /health
├── packages/
│   ├── widget/      the embeddable widget.js (no build step — vanilla JS)
│   └── cli/         @krispyai/cli    the `krispy` bin (set-kbase, dev)
├── agents/          skills + subagents + mcp.json
├── docs/            linting · secrets · agent-skills
├── api-collection/  Bruno API collection for the edge Worker
└── tsconfig.base.json  shared compiler options (never fork)
```

No Nx, no Docker, no monorepo boundary machinery — the core is small enough not to need them. The two surfaces deploy independently. **Local dev** needs no orchestrator (two `bun` scripts, §4); Tilt is used only as the **deploy** control surface (manual buttons that call `./deploy.sh` — see §10), never required to run the app.

## 3. The laws — do not break these

1. **Config, not hardcoding.** No hardcoded URLs, ports, or secrets. The Worker's secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TENANT_SYNC_SECRET`) live in Cloudflare (`wrangler secret put`), never in the repo. The CLI reads `KRISPY_API` / `KRISPY_TENANT` / `TENANT_SYNC_SECRET` from env (see `.env.example`).
2. **One tsconfig source of truth.** Every workspace's `tsconfig.json` extends the root `tsconfig.base.json`. Don't fork compiler options per package.
3. **The widget stays dependency-free.** `widget.js` is vanilla JS in a Shadow DOM — no framework, no bundler, no npm deps. Keep it that way.
4. **The edge Worker stays self-contained.** It has no `@krispy/*` runtime imports; CF runtime globals are hand-declared in `src/cf.d.ts` so it typechecks without `@cloudflare/workers-types`. Don't add a lib dependency to keep it a clean single deploy.
5. **Commits: Conventional Commits + pathspec-only.** Every commit message is `type(scope): summary` (`feat`, `fix`, `docs`, `ci`, `build`, `chore`, `refactor`, `test`, `perf`; scope = `edge`/`widget`/`cli`/`docs`/…) — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Stage by **pathspec** (`git commit <files>`), never `git add -A` / `git add .` / `git stash`, so an unrelated working-tree change never rides along. End every message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 4. How to run

No orchestrator — two `bun` scripts in two terminals:

```bash
bun install
bun run dev:edge      # edge Worker (wrangler dev) on http://localhost:8787
bun run dev:widget    # widget demo (bunx serve) on http://localhost:3000
```

Checks:

- `bun run typecheck` — `tsc` over the edge Worker + CLI.
- `bun run lint` — oxlint (Rust, fast) over the whole repo. `bun run format` / `format:check` — oxfmt. See [`docs/linting.md`](./docs/linting.md).
- `bun run test` — edge unit tests + CLI smoke tests.
- `bun run check` — typecheck + lint + test in one shot.

Deploy the Worker from `services/edge` with `bunx wrangler deploy` (full go-live steps: [`README.md`](./README.md) → Go live).

## 5. Manage the kbase — the `krispy` CLI

The bot's knowledge base **is** its system prompt. Write it in a file and push it into the Worker's KV:

```bash
KRISPY_API=https://krispy-edge.YOU.workers.dev TENANT_SYNC_SECRET=... \
  bun packages/cli/src/index.ts set-kbase ./kbase.md
```

`set-kbase` POSTs to `/api/tenant/config` (guarded by `x-tenant-sync-secret == TENANT_SYNC_SECRET`), which merges the prompt into KV `tenant:<id>`; `getTenant()` in the Worker then drives the bot. `krispy dev` is a thin wrapper over `wrangler dev`. See [`packages/cli/README.md`](./packages/cli/README.md).

## 6. Compliance — enabled gates

- **Secrets are scanned in CI.** `gitleaks` (config `.gitleaks.toml`) fails the build on a committed secret. Never commit real keys.
- **Dependencies are scanned.** An `osv-scanner` CI job runs on every PR.

## 7. DOCUMENTATION SYNC — docs ship in the same change

Any change that adds or modifies **behavior, API surface, config/env vars, or CLI flags** is **incomplete** until the matching docs are updated **in the same PR/commit**:

- **Docs site** — the Fumadocs pages under `apps/docs/content/docs/**` (merged to master — the canonical user-facing surface). Route in the map:
  - edge routes / request-response shapes / error codes / auth → `reference/edge-routes.mdx`
  - tenant-config schema (`TenantConfig`, theme, lead form, connectors) → `reference/tenant-config.mdx`
  - CLI commands / flags → `reference/cli.mdx`
  - widget embed attributes / theming → `reference/markers.mdx` + `guides/embed-and-theme.mdx`
  - feature behavior → the matching `guides/*.mdx`, `concepts.mdx`, or `security.mdx`
- **README** — update the touched-feature section of the root `README.md` (and `services/edge/README.md` / `packages/cli/README.md` when the change lives there).
- **`CHANGELOG.md`** — add an entry under `[Unreleased]`, Keep-a-Changelog style (`Added` / `Changed` / `Fixed` / `Removed`).
- **OpenAPI + Bruno — BOTH required.** Any change to an edge route (new endpoint, changed request/response shape, new error code, auth change) MUST update **both** in the same change:
  - **OpenAPI** — `api-collection/openapi.yaml` (OpenAPI 3.1). There is **no auto-generation** from the Worker, so this file _is_ the machine-readable contract — it only stays true if you edit it. Keep schemas, status codes, error codes, and auth accurate.
  - **Bruno** — the matching `.bru` in `api-collection/` (one folder per domain, one `.bru` per endpoint, `{{baseUrl}}` only — never a hardcoded host).
  - Together with `reference/edge-routes.mdx` (the human-readable page), these three _are_ the API contract. A route change that lands without all three is **incomplete**.

A PR that changes any of the above without the matching docs + CHANGELOG update is **incomplete — do not merge it**.

## 8. Agent tooling — MCP

Copy [`agents/mcp.json`](./agents/mcp.json) → repo-root `.mcp.json` to give your agent context7 (up-to-date library docs) + filesystem (repo-scoped).

### 8.1 Third-party skills / MCPs — vet before you install

A skill or MCP is **executable code running with your agent's permissions, plus a payload the model obeys** — treat it like a dependency you're about to `sudo`. It's the same caution that made us swap a SQL-injectable Postgres MCP for a read-only one. Before an unfamiliar one touches your agent, run the 5-step law:

1. **Scan** — `./scripts/scan-skill.sh <name>` (Clawdex). `malicious` → stop. `unknown` (most raw repos) → manual review + a code scanner, not a pass.
2. **Read the source** — the actual `SKILL.md` **and every bundled script/hook**, not the README. Reject prompt-injection/override language, non-official phone-home URLs, obfuscated/base64 instructions, "act without confirmation", or `curl | sh` installers.
3. **Check permissions** — inspect `allowed-tools` and any hooks (hooks auto-execute = highest risk). Reject broad grants + auto-installed hooks.
4. **Check provenance** — official (`anthropics/*`) / established firm > single-author brand-new repo. Mega-aggregator installer CLIs are untrusted by default. Confirm a real LICENSE.
5. **Prefer first-party; pin commits** — small enough? author it. When you vendor, pin a commit SHA, never a moving branch.

Full law + our curated, scan-gated recommended list (adapt / link-only / reject tiers): [`docs/agent-skills.md`](./docs/agent-skills.md). Scanner: [`scripts/scan-skill.sh`](./scripts/scan-skill.sh).

## 9. Before you finish

- `bun run typecheck` passes (edge + CLI).
- `bun run lint` (oxlint) clean and `bun run format:check` (oxfmt) clean.
- `bun run test` green (edge tests must stay passing).
- New env var is in `.env.example` (with a safe local default, no real secret).
- Any change to an edge route updates **both** `api-collection/openapi.yaml` **and** the matching Bruno request in `api-collection/` (§7).
- **Docs synced (§7):** the matching Fumadocs page(s), the touched README section, and a `CHANGELOG.md` `[Unreleased]` entry are in this same change.
- Conventional-commit message (`feat:`, `fix:`, `docs:` …). See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## 10. CI, deploy & release

The stack has three distinct pipelines. **CI gates; Tilt deploys; a tag publishes.** Keep them separate — CI never deploys, deploy never runs in GitHub Actions.

### CI — `.github/workflows/ci.yml` (PR + push to `master`)

`bun install --frozen-lockfile` → gitleaks (secret scan) → oxlint → oxfmt `--check` → `bun run typecheck` → `bun run test` → **build gate** (builds `apps/docs` when present — it's a standalone Next.js/Fumadocs app with its own `bun.lockb`, installed + built separately; a ref without it skips). A separate `vuln-scan` job runs `osv-scanner`. Same checks as `bun run check` locally + lefthook hooks.

### Deploy — Tilt + Infisical + wrangler (NOT GitHub Actions)

Deploy is a **button you press**, never a CI side effect. Under Tilt (`./tilt_up.sh`, UI on :10440) the `deploy` label holds one manual resource per target × env: `deploy:edge-{preview,production}`, `deploy:docs-{preview,production}`, `deploy:widget-{preview,production}`. Each shells out to the SAME headless script a human uses (DRY):

```bash
./deploy.sh <edge|docs|widget> <preview|production>
```

`deploy.sh` runs **preflight → build → `wrangler deploy` → smoke**:

- **preflight** (`scripts/cf-deploy-preflight.mjs`) — read-only gate: asserts `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are present (fed from Infisical into `.env.local`); blocks with remediation if not. Never writes.
- **build** — `apps/docs` builds; the widget is static (no build); the edge Worker is deployed straight from `src` by wrangler.
- **wrangler deploy** — `--env preview|production`. The edge Worker's named envs (`services/edge/wrangler.toml`) give preview + prod **separate Workers + separate KV** so they never share tenant config/usage. Docs/widget deploy to env-suffixed Pages projects.
- **smoke** (`scripts/cf-deploy-smoke.mjs`) — edge: `GET /health` = 200 `{status:"ok"}`; pages: `GET /` = 200. Skipped (with a warning) until you record the deployed URL in `.env.local` (`EDGE_PRODUCTION_URL`, …).

Secrets doctrine: **Infisical is the source of truth** ([`docs/secrets.md`](./docs/secrets.md)). Deploy creds + Worker runtime secrets originate in Infisical; nothing is hardcoded and no secret ever goes into GitHub Actions.

### Release — publish `@krispyai/cli` via npm Trusted Publishing

Only **`@krispyai/cli`** is published (the Worker + widget are self-hosted, not npm packages — they stay `private`). Release flow:

1. Bump `packages/cli/package.json` `version` + add a `CHANGELOG.md` entry.
2. Tag `vX.Y.Z` and push the tag (or run the workflow via `workflow_dispatch`).
3. `.github/workflows/publish.yml` fires: typecheck + test the CLI, then `npx npm@latest publish --provenance --access public` from `packages/cli` with **`id-token: write`** — npm mints a short-lived, package-scoped credential from the workflow's OIDC identity. **There is NO npm token in the workflow or in GitHub Secrets.**

The CLI is **Bun-native** (`#!/usr/bin/env bun`, `.ts` bin, `bun:test`) — it declares `engines.bun >= 1.1.34` and runs via `bunx @krispyai/cli`, not plain `node`. npm's Node CLI only uploads the tarball; the package's runtime is Bun.

## 11. One-time founder setup

Do these once to make the pipelines above work; agents don't (and can't) do them:

- **Cloudflare** — create the account + (optional) custom domain. Mint an API token with **Workers Scripts:Edit**, **Cloudflare Pages:Edit**, **Workers KV Storage:Edit** (Durable Objects are covered by Workers Scripts). Create the KV namespaces and paste their ids into `services/edge/wrangler.toml` (`REPLACE_WITH_*_KV_ID`).
- **Infisical** — create the project, add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` and the Worker runtime secrets per env; wire the Infisical→Cloudflare connector (or the `.env.local` feed) so nothing is hand-set. See [`docs/secrets.md`](./docs/secrets.md).
- **npm — first-publish bootstrap for `@krispyai/cli`** (Trusted Publishing can't be configured until the package exists):
  1. Create the npm org/scope (`@krispy`). Mint a **Classic Automation** token, store it as the repo secret `NPM_TOKEN`.
  2. Temporarily set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step (drop `--provenance` for this one run), tag `v0.1.0`, let it publish once.
  3. On npmjs.com → the `@krispyai/cli` package → **Trusted Publisher**: add this repo (`lonormaly/krispyai`) + workflow file `.github/workflows/publish.yml`.
  4. **Delete** the `NPM_TOKEN` secret and revert step 2. Tokenless (OIDC) forever after.

## 12. Where to look next

- [`agents/skills/`](./agents/skills/) — generic scaffolding skills (add-a-service, add-a-lib, wire-a-payment-provider) for when you grow the repo back out.
- [`agents/mcp.json`](./agents/mcp.json) — the MCP servers above.
- [`services/edge/README.md`](./services/edge/README.md) — the Worker's architecture notes.
