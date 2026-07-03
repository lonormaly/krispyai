#!/usr/bin/env bun
// krispy — the self-host CLI. Manage your bot's knowledge base (its system prompt)
// without touching wrangler by hand. It POSTs to the edge Worker's tenant-config
// route (`POST /api/tenant/config`), which merges the fields into KV `tenant:<id>`.
//
// Usage:
//   krispy init                 interactive first-run wizard (Telegram → train → embed)
//   krispy set-kbase <file>     write <file>'s contents as the bot's system prompt
//   krispy dev                  start the edge Worker locally (wrangler dev)
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
    case "dev":
      return dev();
    default:
      console.error(
        "krispy <command>\n  init               guided first-run setup (Telegram → train → embed)\n  set-kbase <file>   write a system prompt into the Worker's KV\n  dev                run the edge Worker locally (wrangler dev)",
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
