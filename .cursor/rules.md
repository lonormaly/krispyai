# Cursor rules

> **Single source of truth:** these rules mirror the repo-root [`AGENTS.md`](../AGENTS.md). Codex, Cursor, and Copilot read a root `AGENTS.md` by convention; Claude Code reads `CLAUDE.md`; Cursor also reads this file. Keep the details in root `AGENTS.md` — this is the short version Cursor loads into every prompt.

You are working in **krispyai**, the lean, self-hostable core of Krispy. Before writing code, know the map.

## What's here

- `services/edge` — ⭐ the core Cloudflare Worker + `SessionDO` (chat + Telegram handoff). Self-contained, no `@krispy/*` runtime imports.
- `packages/widget` — ⭐ the dependency-free embeddable `widget.js` (vanilla JS, Shadow DOM).
- `packages/cli` — the `krispy` CLI (`set-kbase`, `dev`).

The dashboard, billing, accounts, and marketing live in a separate Cloud repo — not here.

## Laws (do not break)

1. **No hardcoded URLs/ports/secrets** — Worker secrets in Cloudflare (`wrangler secret put`); CLI reads env (see `.env.example`).
2. **The widget stays dependency-free** — no framework, no bundler, no npm deps.
3. **The edge Worker stays self-contained** — don't add a lib dependency.
4. Every workspace extends root `tsconfig.base.json`. Don't fork compiler options.

## Run

- `bun install`, then `bun run dev:edge` (Worker on :8787) and `bun run dev:widget` (demo on :3000).
- Checks: `bun run typecheck` · `bun run lint` · `bun run test` · `bun run check` (all three).
- Deploy the Worker from `services/edge` with `bunx wrangler deploy`.

## Finishing

Typecheck passes · lint clean · tests green · new env var in `.env.example` · edge-route change mirrored in `api-collection/` · conventional-commit message.

For the full primer and skills see [`agents/`](../agents/) and [`AGENTS.md`](../AGENTS.md).
