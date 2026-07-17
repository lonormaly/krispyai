// Smoke test: the CLI routes commands and guards inputs — run it as a subprocess so
// we exercise the real bin (arg parse + exit codes) without a live Worker.
import { expect, test, describe } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("krispy kb-* (relearning approval inbox)", () => {
  test("usage lists the kb-suggestions command", () => {
    expect(run([]).err).toContain("kb-suggestions");
  });

  test("kb-suggestions without TENANT_SYNC_SECRET → exit 1 before any network call", () => {
    const r = run(["kb-suggestions"], { TENANT_SYNC_SECRET: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("TENANT_SYNC_SECRET");
  });

  test("kb-approve without an id → usage, exit 1", () => {
    const r = run(["kb-approve"], { TENANT_SYNC_SECRET: "x" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage");
  });

  test("kb-dismiss without TENANT_SYNC_SECRET → exit 1 (id present, secret missing)", () => {
    const r = run(["kb-dismiss", "sug_123"], { TENANT_SYNC_SECRET: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("TENANT_SYNC_SECRET");
  });
});

describe("krispy logo (local bg removal)", () => {
  test("no file → usage, exit 1", () => {
    const r = run(["logo"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage");
  });

  test("a flat-background logo → a transparent-PNG data URI on stdout", async () => {
    const sharp = (await import("sharp")).default;
    // A red square (the "logo") on a solid white background the corners agree on.
    const fixture = join(tmpdir(), "krispy-fixture-logo.png");
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 32, height: 32, channels: 3, background: "#ff0000" },
          })
            .png()
            .toBuffer(),
          top: 16,
          left: 16,
        },
      ])
      .png()
      .toBuffer()
      .then((buf) => Bun.write(fixture, buf));

    const r = run(["logo", fixture]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toStartWith("data:image/png;base64,");
    // The chroma-key actually punched the white corners to alpha — decode and check corner α=0.
    const b64 = r.out.trim().slice("data:image/png;base64,".length);
    const { data, info } = await sharp(Buffer.from(b64, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // top-left pixel is transparent
    expect(data[(info.width * info.height - 1) * 4 + 3]).toBe(0); // bottom-right too
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
