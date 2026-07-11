// READ-ONLY deploy gate. Run BEFORE a wrangler deploy:
//   node scripts/cf-deploy-preflight.mjs <preview|production>
//
// Asserts the Cloudflare creds a deploy needs are present in the (Infisical-fed)
// environment — CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID — and blocks with a
// clear remediation if not. It NEVER writes to Cloudflare. Per docs/secrets.md,
// secrets are sourced from .env.local (fed by Infisical), never hardcoded here.
//
// The deploy runner sources .env.local before calling this, so vars are already in
// process.env; we also parse .env.local directly as a fallback for a bare invocation.
import { readFileSync } from "node:fs";

const env = process.argv[2];
if (env !== "preview" && env !== "production") {
  console.error("usage: node scripts/cf-deploy-preflight.mjs <preview|production>");
  process.exit(2);
}

// .env.local parser — strips an inline ' # comment' on unquoted values (the class of
// bug that corrupts a secret by gluing a comment onto it). Best-effort: absent file is fine.
const L = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      let raw = m[2];
      if (!/^\s*["']/.test(raw)) raw = raw.replace(/\s+#.*$/, "");
      L[m[1]] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on process.env (CI / exported shell). */
}

const val = (k) => process.env[k] || L[k];
const REQUIRED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const missing = REQUIRED.filter((k) => !val(k));

if (missing.length) {
  console.error(`\n✘ PREFLIGHT FAILED for ${env} — DEPLOY BLOCKED:\n`);
  for (const k of missing) console.error("   • missing " + k);
  console.error(`\nFix — these are fed from Infisical into .env.local (docs/secrets.md):`);
  console.error(
    `   • Add them in Infisical (project Krispy → ${env} env), then re-sync .env.local.`,
  );
  console.error(`   • Local one-off: export ${missing.join(" and ")} in your shell.`);
  console.error(
    `   • The API token needs: Workers Scripts:Edit, Cloudflare Pages:Edit, Workers KV Storage:Edit.`,
  );
  process.exit(1);
}

console.log(`✔ preflight OK for ${env} — CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID present.`);
