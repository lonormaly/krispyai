# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately:

- open a [GitHub private security advisory](https://github.com/krispyhq/krispyai/security/advisories/new) (Security → Advisories → _Report a vulnerability_). It's private to you and the maintainers until a fix ships.

Please give us a reasonable window to fix and release before any public disclosure. We'll acknowledge your report and keep you posted on the fix.

## Scope

This repo is a **starter template** — you clone it and build your product on top. Reports in scope:

- A vuln in the **core itself**: the edge Worker (`services/edge`) — its Telegram webhook verification, the `x-tenant-sync-secret` gate on `/api/tenant/config` and `/api/billing/entitlement`, the widget's Shadow-DOM isolation (`packages/widget`), the env/secrets handling (`.env.example`, the CLI), the shipped MCP config (`agents/mcp.json`), or a default that is insecure out of the box.
- A dependency we pin that ships a known, exploitable vuln (see [Dependabot](.github/dependabot.yml) — it opens weekly PRs for these automatically).

**Out of scope:** vulnerabilities in _your_ product code after you fork, and issues that require a key/secret you deliberately committed (see below — don't).

## Security posture (what the core guarantees)

- **No secrets in the repo.** The Worker's secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TENANT_SYNC_SECRET`) live in Cloudflare, set with `wrangler secret put` — never in a committed file. `.env.example` documents only the CLI's non-secret config with empty values.
- **The Telegram webhook is authenticated.** The Worker verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` before acting on an inbound update.
- **Config routes are secret-gated.** `POST /api/tenant/config` (and `/api/billing/entitlement`) require `x-tenant-sync-secret == TENANT_SYNC_SECRET`; without it the config (which holds a bot token) is never read or written — the route returns 401.
- **The widget can't be poisoned by the host page.** `widget.js` renders inside a Shadow DOM so host-page CSS/JS can't leak in, and it's dependency-free (no transitive supply-chain surface).

## Supply chain — agent skills & MCPs

A skill or MCP you hand your agent is **executable code running with your agent's permissions, plus a payload the model obeys** — the same swap that replaced the SQL-injectable Postgres MCP with a read-only one applies to everything you add next. Before installing an unfamiliar skill/MCP, run the **"vet before you install" law** (scan → read the source → check permissions/hooks → check provenance → prefer first-party & pin a commit): [`docs/agent-skills.md`](docs/agent-skills.md), with the first-gate reputation check at [`scripts/scan-skill.sh`](scripts/scan-skill.sh). It also carries our curated, scan-gated recommended list so you don't vendor something untrusted.

If you find a gap in any of the above, that's exactly the kind of report we want.
