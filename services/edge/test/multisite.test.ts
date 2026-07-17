// Multi-site: a site is an optional KV-namespace suffix on the tenant. The load-bearing
// property is that an ABSENT/default site collapses to the exact legacy key — so every
// existing single-site tenant is untouched and NOTHING migrates. Run: `bun test`.
import { expect, test, describe } from "bun:test";
import {
  ns,
  kTenant,
  resolveSiteId,
  DEFAULT_SITE,
  readTenantConfig,
  mergeTenantConfig,
} from "../src/store";
import { kSeen, stampSeen, readSeen } from "../src/liveness";
import type { Env } from "../src/types";

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

describe("multi-site namespacing", () => {
  test("MIGRATION SAFETY: an absent or default site collapses to the exact legacy key", () => {
    expect(ns("acme")).toBe("acme");
    expect(ns("acme", undefined)).toBe("acme");
    expect(ns("acme", "")).toBe("acme");
    expect(ns("acme", DEFAULT_SITE)).toBe("acme");
    expect(kTenant("acme")).toBe("tenant:acme"); // the P0 safety assert
    expect(kTenant("acme", DEFAULT_SITE)).toBe("tenant:acme");
    expect(kSeen("acme")).toBe("seen:acme");
  });

  test("a named site suffixes the namespace", () => {
    expect(ns("acme", "shop")).toBe("acme:shop");
    expect(kTenant("acme", "shop")).toBe("tenant:acme:shop");
    expect(kSeen("acme", "shop")).toBe("seen:acme:shop");
  });

  test("resolveSiteId: absent → undefined, valid → value, malformed → null (keyspace guard)", () => {
    expect(resolveSiteId(null)).toBeUndefined();
    expect(resolveSiteId(undefined)).toBeUndefined();
    expect(resolveSiteId("")).toBeUndefined();
    expect(resolveSiteId("shop-2_uk")).toBe("shop-2_uk");
    // malformed — uppercase, spaces, key-delimiter, path, over-length → null
    expect(resolveSiteId("Shop")).toBeNull();
    expect(resolveSiteId("a b")).toBeNull();
    expect(resolveSiteId("a:b")).toBeNull();
    expect(resolveSiteId("a/b")).toBeNull();
    expect(resolveSiteId("x".repeat(41))).toBeNull();
  });

  test("config isolation: default, site A, site B are independent blobs", async () => {
    const { env } = fakeEnv();
    await mergeTenantConfig(env, "acme", { botToken: "T-default", chatId: "1" });
    await mergeTenantConfig(env, "acme", { botToken: "T-a", chatId: "2" }, "shop");
    await mergeTenantConfig(env, "acme", { botToken: "T-b", chatId: "3" }, "blog");
    expect((await readTenantConfig(env, "acme"))!.botToken).toBe("T-default");
    expect((await readTenantConfig(env, "acme", "shop"))!.botToken).toBe("T-a");
    expect((await readTenantConfig(env, "acme", "blog"))!.botToken).toBe("T-b");
    // writing site A never touched the default site
    expect((await readTenantConfig(env, "acme"))!.chatId).toBe("1");
  });

  test("liveness throttle is per-SITE: site B's first heartbeat is not throttled by site A", async () => {
    const { env, writes } = fakeEnv();
    const req = () =>
      new Request("https://edge/api/widget/config", { headers: { Origin: "https://x.com" } });
    await stampSeen(env, "ms-throttle", req(), "site-a");
    await stampSeen(env, "ms-throttle", req(), "site-b"); // different site → NOT throttled
    await stampSeen(env, "ms-throttle", req(), "site-a"); // same site again → throttled
    expect(writes()).toBe(2);
    expect(await readSeen(env, "ms-throttle", "site-a")).not.toBeNull();
    expect(await readSeen(env, "ms-throttle", "site-b")).not.toBeNull();
    expect(await readSeen(env, "ms-throttle")).toBeNull(); // default site never stamped
  });
});
