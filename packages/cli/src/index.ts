#!/usr/bin/env bun
// krispy — the self-host CLI. Manage your bot's knowledge base (its system prompt)
// without touching wrangler by hand. It POSTs to the edge Worker's tenant-config
// route (`POST /api/tenant/config`), which merges the fields into KV `tenant:<id>`.
//
// Usage:
//   krispy set-kbase <file>     write <file>'s contents as the bot's system prompt
//   krispy dev                  start the edge Worker locally (wrangler dev)
//
// Config via env (or flags):
//   KRISPY_API      edge Worker base URL   (default http://localhost:8787)
//   KRISPY_TENANT   tenant id              (default "self")
//   TENANT_SYNC_SECRET   the x-tenant-sync-secret the Worker requires
//
// ponytail: single file, global fetch (Bun/Node 18+), no arg-parser dep — two
// commands don't need one. Grow into a commander/yargs setup only if the surface does.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const API = process.env.KRISPY_API ?? "http://localhost:8787";
const TENANT = process.env.KRISPY_TENANT ?? "self";
const SECRET = process.env.TENANT_SYNC_SECRET;

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
  const res = await fetch(`${API}/api/tenant/config`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-sync-secret": SECRET },
    body: JSON.stringify({ tenantId: TENANT, config: { systemPrompt } }),
  });
  if (!res.ok) {
    console.error(`✗ ${res.status} ${res.statusText} — is the Worker up and the secret right?`);
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
    case "set-kbase":
      return setKbase(rest[0]);
    case "dev":
      return dev();
    default:
      console.error(
        "krispy <command>\n  set-kbase <file>   write a system prompt into the Worker's KV\n  dev                run the edge Worker locally (wrangler dev)",
      );
      return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
