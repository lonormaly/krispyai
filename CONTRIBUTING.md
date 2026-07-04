# Contributing to krispyai

Thanks for helping improve the stack. This repo is the **lean, self-hostable core** — clarity and convention matter more here than in a normal app, because people clone it as a starting point. Keep changes small, keep the map honest.

## Prerequisites

- **[Bun](https://bun.com)** ≥ 1.1.34 (the package manager and runtime — never `npm`/`yarn`/`pnpm`).
- A **Cloudflare account** (free) for `wrangler dev` / deploy.
- Node isn't required to run the app, but some MCP servers (`agents/mcp.json`) use `npx`.

## Get it running

```bash
git clone https://github.com/krispyhq/krispyai
cd krispyai
cp .env.example .env.local        # only needed for the krispy CLI
bun install
bun run dev:edge                  # edge Worker (wrangler dev) on :8787
bun run dev:widget                # widget demo (bunx serve) on :3000
```

No Tilt, no Docker, no orchestrator — the core is two `bun` scripts in two terminals.

### Git hooks (recommended)

Enable the shipped [`lefthook.yml`](./lefthook.yml) once so you can't commit drift:

```bash
bunx lefthook install
```

`pre-commit` formats + lints your **staged files** (`oxfmt` + `oxlint`, sub-second); `pre-push` runs `bun run typecheck`. This is the same gate CI runs, moved to your machine. Bypass with `LEFTHOOK=0 git commit …` or `--no-verify` when you must.

## The map (read before you add code)

| Path | Role |
| --- | --- |
| `services/edge` | ⭐ the Cloudflare Worker + `SessionDO` — chat + Telegram handoff |
| `packages/widget` | ⭐ the dependency-free embeddable `widget.js` |
| `packages/cli` | the `krispy` CLI (`set-kbase`, `dev`) |

Full detail lives in [`AGENTS.md`](./AGENTS.md).

### The laws (do not break)

1. **No hardcoded URLs/ports/secrets** — use env; Worker secrets go in Cloudflare (`wrangler secret put`), never in the repo.
2. **The widget stays dependency-free** — vanilla JS, no framework, no bundler, no npm deps.
3. **The edge Worker stays self-contained** — no `@krispy/*` runtime imports.
4. Every workspace extends `tsconfig.base.json`.

## Growing the repo back out

There are step-by-step scaffolding skills if you extend beyond the core:

- **New shared code (2+ consumers)** → [`agents/skills/add-a-lib`](./agents/skills/add-a-lib/SKILL.md)
- **New thing with a URL/deploy** → [`agents/skills/add-a-service`](./agents/skills/add-a-service/SKILL.md)
- **New payment provider** → [`agents/skills/wire-a-new-payment-provider`](./agents/skills/wire-a-new-payment-provider/SKILL.md)

## Commit messages — Conventional Commits

Format: `type(scope): summary`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`. Scope is the package or area (`edge`, `widget`, `cli`, `docs`).

```
feat(edge): add a rate limit to the chat route
fix(widget): stop CSS leaking through the shadow root
docs(readme): document the krispy CLI
```

## Pull request flow

1. **Branch** off `main`: `feat/short-name`.
2. Make the change **small and focused** — one concern per PR.
3. Run locally before pushing:
   ```bash
   bun install
   bun run check            # typecheck + lint + test — CI runs the same
   ```
4. If you added/changed an edge route, update the matching Bruno request in [`api-collection/`](./api-collection/). If you added an env var, update `.env.example`.
5. Open the PR using the template. Fill in what changed, why, and how you verified it.
6. CI (`.github/workflows/ci.yml`) runs install + lint + typecheck + test. Green CI + one review → merge.

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to uphold it.
