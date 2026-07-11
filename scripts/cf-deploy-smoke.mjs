// Post-deploy smoke test. Run AFTER a wrangler deploy:
//   node scripts/cf-deploy-smoke.mjs <kind> <baseUrl>
//     kind = edge   → GET <baseUrl>/health must be 200 and { status: "ok" }
//     kind = pages  → GET <baseUrl>/ must be 200 (docs site / widget bundle)
//
// Exits non-zero if the check fails, so the Tilt deploy resource turns red on a
// broken go-live instead of reporting a false green.
const kind = process.argv[2];
const base = (process.argv[3] || "").replace(/\/$/, "");
if ((kind !== "edge" && kind !== "pages") || !base) {
  console.error("usage: node scripts/cf-deploy-smoke.mjs <edge|pages> <baseUrl>");
  process.exit(2);
}

async function main() {
  if (kind === "edge") {
    const r = await fetch(`${base}/health`);
    if (r.status !== 200) throw new Error(`/health ${r.status} (expected 200)`);
    const j = await r.json().catch(() => ({}));
    if (j.status !== "ok")
      throw new Error(`/health body ${JSON.stringify(j)} (expected status: ok)`);
    console.log(`✔ smoke OK — ${base}/health 200 { status: "ok" }`);
  } else {
    const r = await fetch(`${base}/`);
    if (r.status !== 200) throw new Error(`/ ${r.status} (expected 200)`);
    console.log(`✔ smoke OK — ${base}/ 200`);
  }
}

main().catch((e) => {
  console.error(`\n✘ SMOKE FAILED for ${base} — ${e.message}`);
  process.exit(1);
});
