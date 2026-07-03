<!-- Keep PRs small and focused — one concern each. -->

## What & why

<!-- What does this change, and why? Link any issue: Closes #123 -->

## Type

<!-- Conventional-commit type -->

- [ ] feat · [ ] fix · [ ] docs · [ ] refactor · [ ] test · [ ] chore · [ ] ci

## How I verified

<!-- Commands you ran, endpoints you hit, screenshots if UI. -->

- [ ] `bun run check` passes (typecheck + lint + test)
- [ ] Ran locally via `bun run dev:edge` / `bun run dev:widget`

## Convention checklist

- [ ] No hardcoded URLs/ports/secrets (env only; Worker secrets via `wrangler secret put`)
- [ ] The widget stays dependency-free
- [ ] The edge Worker stays self-contained (no `@krispy/*` runtime imports)
- [ ] New env vars added to `.env.example` (no real secrets)
- [ ] New/changed edge route reflected in `api-collection/` (Bruno)
