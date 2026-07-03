// Smoke test: the CLI routes commands and guards inputs — run it as a subprocess so
// we exercise the real bin (arg parse + exit codes) without a live Worker.
import { expect, test, describe } from "bun:test";

const BIN = new URL("../src/index.ts", import.meta.url).pathname;

function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bun", BIN, ...args], {
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    code: proc.exitCode,
    err: proc.stderr.toString(),
    out: proc.stdout.toString(),
  };
}

describe("krispy cli", () => {
  test("no command → usage, exit 0", () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("set-kbase");
  });

  test("unknown command → exit 1", () => {
    expect(run(["frobnicate"]).code).toBe(1);
  });

  test("set-kbase without a file → exit 1", () => {
    const r = run(["set-kbase"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage");
  });

  test("set-kbase without TENANT_SYNC_SECRET → exit 1 before any network call", () => {
    const r = run(["set-kbase", "kbase.md"], { TENANT_SYNC_SECRET: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("TENANT_SYNC_SECRET");
  });

  test("usage lists the init command", () => {
    expect(run([]).err).toContain("init");
  });

  test("init in a non-TTY (piped subprocess) → exit 1, doesn't hang", () => {
    const r = run(["init"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("TTY");
  });
});

describe("telegramGetMe (token validate path)", () => {
  // Import the real function; stub global fetch so we exercise the ok/reject branches
  // without hitting Telegram. Restore fetch after each case.
  test("a fake/rejected token → null (no hang, no throw)", async () => {
    const { telegramGetMe } = await import("../src/index.ts");
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: false, error_code: 401 }), { status: 401 });
    try {
      expect(await telegramGetMe("fake:token")).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("a valid token → the bot @username", async () => {
    const { telegramGetMe } = await import("../src/index.ts");
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, result: { username: "mybot" } }), { status: 200 });
    try {
      expect(await telegramGetMe("123:real")).toBe("mybot");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
