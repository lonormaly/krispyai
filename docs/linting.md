# Linting & formatting — Oxlint + Oxfmt

**Oxlint + Oxfmt (Rust, from the oxc / VoidZero project) do all the linting and
formatting** — they're ~30x faster than the ESLint/Prettier pair, and the lean core
is small enough that they cover everything it needs.

## The division of labor

| Tool       | Job                                                                    | Command                     |
| ---------- | ---------------------------------------------------------------------- | --------------------------- |
| **Oxlint** | All linting (correctness, TS, imports), type-aware                     | `bun run lint`              |
| **Oxfmt**  | Formatting (replaces Prettier)                                         | `bun run format` / `:check` |

## Config files

- **`.oxlintrc.json`** — categories (`correctness: error`, `suspicious: warn`), plugins
  (typescript, unicorn, oxc, import), and **type-aware** rules (`options.typeAware: true`,
  powered by `oxlint-tsgolint`). `typescript/no-base-to-string` is downgraded to `warn`
  (it fires on defensive parsing of untyped external webhook JSON).
- **`.oxfmtrc.json`** — Oxfmt is Prettier-compatible; its defaults (double quotes, semicolons,
  2-space, width 100) already match the repo, so the config only lists `ignorePatterns` for
  build output. Oxfmt also respects `.gitignore` and `.prettierignore` automatically.

## Note on type-aware linting

Type-aware rules (via `oxlint-tsgolint`, a beta) auto-discover each project's `tsconfig.json`.
They surface as **warnings** here (non-blocking) so `bun run lint` stays green while still
flagging unsafe assertions etc. Promote any you want enforced to `error` in `.oxlintrc.json`.
