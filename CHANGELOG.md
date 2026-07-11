# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every PR that changes behavior, API surface, config/env vars, or CLI flags MUST add an
entry under `[Unreleased]` (see `AGENTS.md` §7 — Documentation sync).

## [Unreleased]

### Added

- Chat suite: lead capture + connectors — edge fan-out and a data-driven widget lead form.
- Chat suite: widget theming — `:host` `--k-*` CSS vars, boot-fetch of tenant config, avatar/greeting/position, CSS-boundary sanitizers.
- Chat suite: keyboard-aware floating widget card on mobile (visualViewport pin, safe-area, 16px inputs).
- Chat suite: message notifications — WebAudio ding, launcher pulse, unread dot, visitor mute (`theme.sound`).
- Chat suite: safe minimal markdown in bot/operator bubbles (bold/italic/code/links, XSS-safe; visitor text stays literal).
- Chat suite: security guardrails — always-appended `SECURITY_INSTRUCTION` in the system prompt (refuses prompt/architecture/secret disclosure, injection resistance); survives custom tenant prompt overrides.
- Docs site: Fumadocs documentation site under `apps/docs` (quickstart, concepts, security, guides, reference for edge routes / tenant config / CLI / markers).
- Governance: `CHANGELOG.md` + documentation-sync rule (`AGENTS.md` §7).

### Changed

- Edge hardening per security audit: self KV-config merge, fetch timeouts, Telegram mirror best-effort, WS backoff cap, lead rate-limit, DO internal auth.

### Fixed

- Dev servers run on fixed ports — edge (wrangler) + widget; portless is an alias only.

## [0.1.0] — baseline (backfilled)

The lean self-hostable core, as first published:

### Added

- `services/edge` — Cloudflare Worker + hibernatable `SessionDO`: AI chat, Telegram human handoff, tenant-config sync endpoints (`GET/POST /api/tenant/config`), usage + health routes.
- `packages/widget` — dependency-free embeddable `widget.js` (vanilla JS in a Shadow DOM).
- `packages/cli` — the `krispy` CLI: `set-kbase`, `dev`, and the interactive `krispy init` self-host onboarding wizard (BotFather + `getMe` validate-on-paste, kbase, embed, next steps).
- Chat cost controls: sliding message window, output token cap, handoff-on-turns, token metering (env-tunable).
- `api-collection/` — Bruno collection for the edge Worker's routes.
- CI compliance gates: `gitleaks` secret scanning + `osv-scanner` dependency scanning.
