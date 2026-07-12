// Minimal Cloudflare Workers runtime types — only the surface this service uses.
// Hand-declared instead of depending on @cloudflare/workers-types so the edge
// service typechecks self-contained (no extra dep, no lockfile churn). If you
// later add @cloudflare/workers-types, delete this file — the real types supersede.
export {};

declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
    list(opts?: {
      prefix?: string;
      cursor?: string;
      limit?: number;
    }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
  }

  interface DurableObjectId {
    readonly name?: string;
  }
  interface DurableObjectStub {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }
  interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }
  interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  }
  interface DurableObjectState {
    acceptWebSocket(ws: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    readonly storage: DurableObjectStorage;
  }

  // Workers AI binding.
  interface Ai {
    run(model: string, input: unknown): Promise<unknown>;
  }

  // Server end of a CF WebSocket pair. `new Response(null, { webSocket })` returns
  // the client end to the browser (status 101).
  class WebSocketPair {
    0: WebSocket;
    1: WebSocket;
  }
  interface ResponseInit {
    webSocket?: WebSocket | null;
  }
}
