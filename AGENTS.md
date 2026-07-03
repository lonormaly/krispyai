# AGENTS.md — the primer for coding agents

Cross-tool guide for any AI coding agent working in this repo (Claude Code, Cursor, Codex, Copilot, Windsurf, …).
Codex, Cursor, and Copilot read a repo-root `AGENTS.md` by convention — **this file is the source of truth.** Claude Code also reads [`CLAUDE.md`](./CLAUDE.md); Cursor reads [`.cursor/rules.md`](./.cursor/rules.md). Both are short mirrors that point back here.

Read this **before writing code**. It tells you where everything lives so you don't reinvent what already exists.

---

## 1. What this repo is

This is the **lean, self-hostable core** of Krispy — open-source live chat with an AI answerer and a human handoff to Telegram. Only what a user self-hosts ships here. The dashboard, billing, accounts, and marketing surfaces live in a separate Cloud repo and are **not** in this tree.

There are exactly **two deployable things** plus the CLI to run them:

| Path | What it is |
| --- | --- |
| `services/edge` | ⭐ the core — one Cloudflare Worker + a hibernatable Durable Object (`SessionDO`). Chat + Telegram handoff. The whole backend, one deploy. |
| `packages/widget` | ⭐ the core — the dependency-free embeddable `widget.js` (vanilla JS in a Shadow DOM, zero deps). |
| `packages/cli` | the `krispy` CLI — manage your bot's knowledge base (its system prompt) via the Worker's tenant-config route. |

Supporting: `agents/skills/` (generic scaffolding skills), `docs/` (linting · secrets · agent-skills), `api-collection/` (Bruno requests for the edge Worker's routes).

## 2. The map

```
krispyai/
├── services/
│   └── edge/        @krispy/edge   Cloudflare Worker + SessionDO — POST /api/chat, /api/contact,
│                                   /api/telegram/webhook, /api/tenant/config, GET /api/usage, /health
├── packages/
│   ├── widget/      the embeddable widget.js (no build step — vanilla JS)
│   └── cli/         @krispy/cli    the `krispy` bin (set-kbase, dev)
├── agents/          skills + subagents + mcp.json
├── docs/            linting · secrets · agent-skills
├── api-collection/  Bruno API collection for the edge Worker
└── tsconfig.base.json  shared compiler options (never fork)
```

No Nx, no Tilt, no Docker, no monorepo boundary machinery — the core is small enough not to need them. The two surfaces deploy independently.

## 3. The laws — do not break these

1. **Config, not hardcoding.** No hardcoded URLs, ports, or secrets. The Worker's secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TENANT_SYNC_SECRET`) live in Cloudflare (`wrangler secret put`), never in the repo. The CLI reads `KRISPY_API` / `KRISPY_TENANT` / `TENANT_SYNC_SECRET` from env (see `.env.example`).
2. **One tsconfig source of truth.** Every workspace's `tsconfig.json` extends the root `tsconfig.base.json`. Don't fork compiler options per package.
3. **The widget stays dependency-free.** `widget.js` is vanilla JS in a Shadow DOM — no framework, no bundler, no npm deps. Keep it that way.
4. **The edge Worker stays self-contained.** It has no `@krispy/*` runtime imports; CF runtime globals are hand-declared in `src/cf.d.ts` so it typechecks without `@cloudflare/workers-types`. Don't add a lib dependency to keep it a clean single deploy.

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

## 7. Agent tooling — MCP

Copy [`agents/mcp.json`](./agents/mcp.json) → repo-root `.mcp.json` to give your agent context7 (up-to-date library docs) + filesystem (repo-scoped).

### 7.1 Third-party skills / MCPs — vet before you install

A skill or MCP is **executable code running with your agent's permissions, plus a payload the model obeys** — treat it like a dependency you're about to `sudo`. It's the same caution that made us swap a SQL-injectable Postgres MCP for a read-only one. Before an unfamiliar one touches your agent, run the 5-step law:

1. **Scan** — `./scripts/scan-skill.sh <name>` (Clawdex). `malicious` → stop. `unknown` (most raw repos) → manual review + a code scanner, not a pass.
2. **Read the source** — the actual `SKILL.md` **and every bundled script/hook**, not the README. Reject prompt-injection/override language, non-official phone-home URLs, obfuscated/base64 instructions, "act without confirmation", or `curl | sh` installers.
3. **Check permissions** — inspect `allowed-tools` and any hooks (hooks auto-execute = highest risk). Reject broad grants + auto-installed hooks.
4. **Check provenance** — official (`anthropics/*`) / established firm > single-author brand-new repo. Mega-aggregator installer CLIs are untrusted by default. Confirm a real LICENSE.
5. **Prefer first-party; pin commits** — small enough? author it. When you vendor, pin a commit SHA, never a moving branch.

Full law + our curated, scan-gated recommended list (adapt / link-only / reject tiers): [`docs/agent-skills.md`](./docs/agent-skills.md). Scanner: [`scripts/scan-skill.sh`](./scripts/scan-skill.sh).

## 8. Before you finish

- `bun run typecheck` passes (edge + CLI).
- `bun run lint` (oxlint) clean and `bun run format:check` (oxfmt) clean.
- `bun run test` green (edge tests must stay passing).
- New env var is in `.env.example` (with a safe local default, no real secret).
- Any change to a `functions`/route also updates the matching Bruno request in `api-collection/`.
- Conventional-commit message (`feat:`, `fix:`, `docs:` …). See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## 9. Where to look next

- [`agents/skills/`](./agents/skills/) — generic scaffolding skills (add-a-service, add-a-lib, wire-a-payment-provider) for when you grow the repo back out.
- [`agents/mcp.json`](./agents/mcp.json) — the MCP servers above.
- [`services/edge/README.md`](./services/edge/README.md) — the Worker's architecture notes.
