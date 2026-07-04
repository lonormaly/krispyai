# krispy docs 🥐

The Krispy AI documentation site — [Fumadocs](https://fumadocs.dev) (Next.js + MDX),
themed to the Krispy boulangerie palette (espresso · cream · gold · jam · pistachio, hard
offset shadows, mono uppercase micro-labels).

Content lives in [`content/docs`](./content/docs) as MDX. Everything is derived from the
actual code in `services/edge`, `packages/widget`, and `packages/cli` — no invented
features.

## Develop

This app is **standalone** — it keeps its own `bun.lockb` and is intentionally **not** in
the root workspaces, so cloning the lean core doesn't pull Next/React into a core install.

```sh
cd apps/docs
bun install
bun run dev        # http://localhost:3000
```

## Build

```sh
bun run build      # fumadocs-mdx generates .source/, then next build (static export-ready)
```

`fumadocs-mdx` runs on `postinstall` and on `dev`/`build`, regenerating the git-ignored
`.source/` directory from `content/docs`.

## Deploy

Target: **Cloudflare Pages**. TODO: real domain (e.g. `docs.krispyai.com`). Point Pages at
this app (`apps/docs`), build command `bun run build`. For a fully static deploy you can add
`output: "export"` to `next.config.mjs` and disable the `/api/search` route (or swap to
Fumadocs' static search index) — the current setup uses Next's server search route.

## Structure

| path                     | what                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `content/docs/*.mdx`     | the docs pages (Quickstart · Concepts · Guides · Reference · Security) |
| `content/docs/meta.json` | nav ordering (per folder)                                              |
| `source.config.ts`       | Fumadocs MDX source config                                             |
| `lib/source.ts`          | the content loader (served under `/docs`)                              |
| `app/global.css`         | the Krispy theme (palette + neo-brutalist chrome)                      |
| `app/layout.config.tsx`  | shared nav (title, links)                                              |
