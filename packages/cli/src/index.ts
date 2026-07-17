#!/usr/bin/env bun
// krispy — the self-host CLI. Manage your bot's knowledge base (its system prompt)
// without touching wrangler by hand. It POSTs to the edge Worker's tenant-config
// route (`POST /api/tenant/config`), which merges the fields into KV `tenant:<id>`.
//
// Usage:
//   krispy init                 interactive first-run wizard (Telegram → train → embed)
//   krispy set-kbase <file>     write <file>'s contents as the bot's system prompt
//   krispy logo <file>          remove a logo's bg locally → paste-ready avatar data URI
//   krispy kb-suggestions       list pending relearning suggestions (approval inbox)
//   krispy kb-approve <id>      approve a suggestion → add it to the bot's kbase
//   krispy kb-dismiss <id>      dismiss a suggestion
//   krispy dev                  start the edge Worker locally (wrangler dev)
//
// The kb-* commands accept an optional --site <id> flag (→ ?s= / siteId) to scope a
// single site; omit it for the tenant's default site.
//
// Config via env (or flags):
//   KRISPY_API      edge Worker base URL   (default http://localhost:8787)
//   KRISPY_TENANT   tenant id              (default "self")
//   TENANT_SYNC_SECRET   the x-tenant-sync-secret the Worker requires
//
// ponytail: single-file core, global fetch (Bun/Node 18+), no arg-parser dep — a few
// commands don't need one. `init` (the guided wizard, with its two prompt deps) lives
// in ./init.ts so this core stays lean and dep-free.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export const API = process.env.KRISPY_API ?? "http://localhost:8787";
export const TENANT = process.env.KRISPY_TENANT ?? "self";
const SECRET = process.env.TENANT_SYNC_SECRET;

// Shared tenant-config POST — the single write path init + set-kbase both go through.
// Throws on a missing secret / non-OK response so callers surface a clear message.
export async function postTenantConfig(config: Record<string, unknown>): Promise<void> {
  if (!SECRET) {
    throw new Error("TENANT_SYNC_SECRET is required (must match the Worker's TENANT_SYNC_SECRET).");
  }
  const res = await fetch(`${API}/api/tenant/config`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-sync-secret": SECRET },
    body: JSON.stringify({ tenantId: TENANT, config }),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — is the Worker up and the secret right?`);
  }
}

// Validate a Telegram bot token via getMe. Returns the bot's @username on success,
// null on any rejection (bad token, network) — never throws, never hangs indefinitely.
export async function telegramGetMe(token: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    return body.ok && body.result?.username ? body.result.username : null;
  } catch {
    return null;
  }
}

async function setKbase(file: string | undefined): Promise<number> {
  if (!file) {
    console.error("usage: krispy set-kbase <file>");
    return 1;
  }
  if (!SECRET) {
    console.error("TENANT_SYNC_SECRET is required (must match the Worker's TENANT_SYNC_SECRET).");
    return 1;
  }
  const systemPrompt = (await readFile(file, "utf8")).trim();
  try {
    await postTenantConfig({ systemPrompt });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  console.log(`✓ kbase updated for tenant "${TENANT}" (${systemPrompt.length} chars) → ${API}`);
  return 0;
}

// A machine-proposed Q→A the operator answered that the bot couldn't (mirror of the
// edge's KbSuggestion — the CLI stays self-contained, so it's re-declared, not imported).
interface KbSuggestion {
  id: string;
  question: string;
  answer: string;
  createdAt: number;
}

// Pull an optional `--site <id>` (or `--site=<id>`) flag out of args; returns the site id
// (or undefined → the tenant's default site) and the remaining positional args.
function parseSite(args: string[]): { site?: string; rest: string[] } {
  const rest: string[] = [];
  let site: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--site") site = args[++i];
    else if (a.startsWith("--site=")) site = a.slice("--site=".length);
    else rest.push(a);
  }
  return { site, rest };
}

// GET /api/tenant/kb-suggestions — list the pending relearning suggestions (approval inbox).
async function kbSuggestions(args: string[]): Promise<number> {
  const { site } = parseSite(args);
  if (!SECRET) {
    console.error("TENANT_SYNC_SECRET is required (must match the Worker's TENANT_SYNC_SECRET).");
    return 1;
  }
  const qs = new URLSearchParams({ t: TENANT });
  if (site) qs.set("s", site);
  let suggestions: KbSuggestion[];
  try {
    const res = await fetch(`${API}/api/tenant/kb-suggestions?${qs}`, {
      headers: { "x-tenant-sync-secret": SECRET },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — is the Worker up and the secret right?`);
    }
    ({ suggestions } = (await res.json()) as { suggestions: KbSuggestion[] });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  const scope = `tenant "${TENANT}"${site ? ` / site "${site}"` : ""}`;
  if (!suggestions.length) {
    console.log(`No pending suggestions for ${scope}.`);
    return 0;
  }
  console.log(`${suggestions.length} pending suggestion(s) for ${scope}:\n`);
  for (const s of suggestions) {
    console.log(`${s.id}`);
    console.log(`  Q: ${s.question}`);
    console.log(`  A: ${s.answer}`);
    console.log(`  approve: krispy kb-approve ${s.id}${site ? ` --site ${site}` : ""}\n`);
  }
  return 0;
}

// POST /api/tenant/kb-approve | kb-dismiss — approve a suggestion into the kbase, or drop it.
// One function: the two routes share body shape ({ tenantId, siteId?, id }) and auth.
async function kbResolve(action: "approve" | "dismiss", args: string[]): Promise<number> {
  const { site, rest } = parseSite(args);
  const id = rest[0];
  if (!id) {
    console.error(`usage: krispy kb-${action} <id> [--site <id>]`);
    return 1;
  }
  if (!SECRET) {
    console.error("TENANT_SYNC_SECRET is required (must match the Worker's TENANT_SYNC_SECRET).");
    return 1;
  }
  try {
    const res = await fetch(`${API}/api/tenant/kb-${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-sync-secret": SECRET },
      body: JSON.stringify({ tenantId: TENANT, siteId: site, id }),
    });
    if (res.status === 404) {
      console.error(`✗ no pending suggestion with id "${id}"`);
      return 1;
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — is the Worker up and the secret right?`);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  console.log(
    action === "approve"
      ? `✓ approved "${id}" → added to kbase for tenant "${TENANT}"`
      : `✓ dismissed "${id}" for tenant "${TENANT}"`,
  );
  return 0;
}

// ponytail: `dev` just shells out to wrangler in services/edge — no reimplementation.
function dev(): Promise<number> {
  const child = spawn("bunx", ["wrangler", "dev"], {
    cwd: new URL("../../../services/edge/", import.meta.url).pathname,
    stdio: "inherit",
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "init": {
      // Lazy-load the wizard (and its two prompt deps) only when init actually runs.
      const { init } = await import("./init.ts");
      return init();
    }
    case "set-kbase":
      return setKbase(rest[0]);
    case "kb-suggestions":
      return kbSuggestions(rest);
    case "kb-approve":
      return kbResolve("approve", rest);
    case "kb-dismiss":
      return kbResolve("dismiss", rest);
    case "logo": {
      // Lazy-load the logo pipeline (and its sharp dep) only when logo actually runs.
      const { logo } = await import("./logo.ts");
      return logo(rest[0]);
    }
    case "dev":
      return dev();
    default:
      console.error(
        "krispy <command>\n  init                 guided first-run setup (Telegram → train → embed)\n  set-kbase <file>     write a system prompt into the Worker's KV\n  logo <file>          remove a logo's bg locally → paste-ready avatar data URI\n  kb-suggestions       list pending relearning suggestions (--site <id>)\n  kb-approve <id>      approve a suggestion → add it to the kbase (--site <id>)\n  kb-dismiss <id>      dismiss a suggestion (--site <id>)\n  dev                  run the edge Worker locally (wrangler dev)",
      );
      return cmd ? 1 : 0;
  }
}

// Only run as a bin — not when imported (tests import telegramGetMe/postTenantConfig).
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
