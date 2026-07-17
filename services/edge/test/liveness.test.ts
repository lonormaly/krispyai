// Widget liveness — the free heartbeat off /api/widget/config. Run: `bun test`.
import { expect, test, describe } from "bun:test";
import { stampSeen, readSeen, kSeen, SEEN_THROTTLE_MS, type SeenRecord } from "../src/liveness";
import type { Env } from "../src/types";

// Minimal KV-backed env + a write counter so we can assert the throttle.
function fakeEnv(): { env: Env; writes: () => number } {
  const kv = new Map<string, string>();
  let writes = 0;
  const env = {
    KRISPY_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        writes++;
        kv.set(k, v);
      },
    },
  } as unknown as Env;
  return { env, writes: () => writes };
}

const req = (headers: Record<string, string>) =>
  new Request("https://edge/api/widget/config?t=t1", { headers });

describe("widget liveness", () => {
  test("stampSeen records timestamp + origin from Origin header", async () => {
    const { env } = fakeEnv();
    await stampSeen(env, "seen-origin", req({ Origin: "https://shop.example.com" }));
    const rec = await readSeen(env, "seen-origin");
    expect(rec).not.toBeNull();
    expect(rec!.origin).toBe("https://shop.example.com");
    expect(typeof rec!.at).toBe("number");
  });

  test("falls back to Referer for origin + full url when no Origin header", async () => {
    const { env } = fakeEnv();
    await stampSeen(
      env,
      "seen-referer",
      req({ Referer: "https://shop.example.com/pricing?ref=x" }),
    );
    const rec = (await readSeen(env, "seen-referer")) as SeenRecord;
    expect(rec.origin).toBe("https://shop.example.com");
    expect(rec.url).toBe("https://shop.example.com/pricing?ref=x");
  });

  test("throttled in-isolate: a second stamp within the window does NOT write again", async () => {
    const { env, writes } = fakeEnv();
    // unique tenant so this isolate's throttle map isn't already primed by another test
    await stampSeen(env, "throttle-tenant", req({ Origin: "https://a.com" }));
    await stampSeen(env, "throttle-tenant", req({ Origin: "https://b.com" }));
    expect(writes()).toBe(1); // second call short-circuited
    // the stored record is from the first (un-throttled) write
    expect((await readSeen(env, "throttle-tenant"))!.origin).toBe("https://a.com");
  });

  test("readSeen returns null when the widget never phoned home", async () => {
    const { env } = fakeEnv();
    expect(await readSeen(env, "never-seen")).toBeNull();
  });

  test("kSeen key is namespaced and distinct from the tenant config key", () => {
    expect(kSeen("acme")).toBe("seen:acme");
    expect(SEEN_THROTTLE_MS).toBeGreaterThan(0);
  });
});
