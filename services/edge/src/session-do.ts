// SessionDO — one Durable Object per (tenant, session). Two jobs:
//   1. Hibernatable WebSocket fan-out (state.acceptWebSocket) → pushes operator
//      replies to the visitor's browser with ZERO idle billing.
//   2. The strongly-consistent `handedOff` flag — the single source of truth for
//      "a human took over, bot goes silent" (KV would be too eventually-consistent
//      for a switch that must flip instantly).
//
// Internal HTTP surface (called by the Worker, never the browser directly):
//   GET  (Upgrade: websocket)  → visitor connects; gets {type:"ready", handedOff}
//   GET  /state                → { handedOff }   (chat flow reads this)
//   POST /operator {text}      → set handedOff, broadcast operator reply
//   POST /handoff              → broadcast a handoff prompt (AI escalation)
import type { Env, ServerEvent } from "./types";
import { DO_INTERNAL_HEADER, doInternalSecret } from "./store";

interface Sendable {
  send(data: string): void;
}

/** Pure fan-out: send an event to every socket, ignoring dead ones. Unit-tested. */
export function broadcast(sockets: Sendable[], event: ServerEvent): number {
  const payload = JSON.stringify(event);
  let delivered = 0;
  for (const ws of sockets) {
    try {
      ws.send(payload);
      delivered++;
    } catch {
      /* dead socket — the runtime prunes it */
    }
  }
  return delivered;
}

export class SessionDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async handedOff(): Promise<boolean> {
    return (await this.state.storage.get<boolean>("handedOff")) === true;
  }

  /** The internal (Worker-only) HTTP surface is state-mutating — require the shared
   * secret so only our Worker can flip handoff / broadcast. The WS upgrade stays open
   * (the session id is the capability the browser holds). */
  private internalAuthed(request: Request): boolean {
    return request.headers.get(DO_INTERNAL_HEADER) === doInternalSecret(this.env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server); // hibernatable — no idle billing
      const event: ServerEvent = { type: "ready", handedOff: await this.handedOff() };
      try {
        server.send(JSON.stringify(event));
      } catch {
        /* noop */
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // Everything past the WS upgrade is the internal Worker→DO surface — gated.
    if (!this.internalAuthed(request)) return new Response("forbidden", { status: 403 });

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      return Response.json({ handedOff: await this.handedOff() });
    }

    if (request.method === "POST" && url.pathname.endsWith("/operator")) {
      const { text } = (await request.json()) as { text: string };
      await this.state.storage.put("handedOff", true);
      const n = broadcast(this.state.getWebSockets(), { type: "operator", text });
      return Response.json({ ok: true, delivered: n });
    }

    if (request.method === "POST" && url.pathname.endsWith("/handoff")) {
      const n = broadcast(this.state.getWebSockets(), { type: "handoff" });
      return Response.json({ ok: true, delivered: n });
    }

    return new Response("not found", { status: 404 });
  }

  // ── hibernation handlers (required with acceptWebSocket) ──────────────────
  // Visitors are receive-only; we answer their keepalive ping so proxies don't
  // idle-close the socket. Everything else is ignored.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") {
      try {
        ws.send("pong");
      } catch {
        /* noop */
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, "closing");
    } catch {
      /* noop */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* noop */
    }
  }
}
