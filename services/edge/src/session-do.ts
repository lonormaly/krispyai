// SessionDO — one Durable Object per (tenant, session). Two jobs:
//   1. Hibernatable WebSocket fan-out (state.acceptWebSocket) → pushes operator
//      replies to the visitor's browser with ZERO idle billing.
//   2. The strongly-consistent `handedOff` flag — the single source of truth for
//      "a human took over, bot goes silent" (KV would be too eventually-consistent
//      for a switch that must flip instantly).
//
// Internal HTTP surface (called by the Worker, never the browser directly):
//   GET  (Upgrade: websocket)  → visitor connects; gets {type:"ready", handedOff}
//                                (?role=operator tags the socket — Buttr app, §3d)
//   GET  /state                → { handedOff }   (legacy read; chat's fallback path)
//   GET  /context              → { handedOff, messages }  (one combined read — the chat
//                                flow's authoritative memory + handoff flag per turn)
//   GET  /summary              → { handedOff, resolved, lastMessage, ts }  (operator inbox row)
//   GET  /log                  → { messages }    (the 20-msg ring — thread read)
//   POST /log {messages,seed?} → append to the ring (seed: only if the ring is empty)
//   POST /operator {text}      → set handedOff, broadcast + ring-append operator reply
//                                (also cancels the silence hand-back alarm)
//   POST /handoff              → broadcast a handoff prompt (AI escalation)
//   POST /resolve {resolved?}  → toggle (or force-set) the `resolved` flag (operator
//                                inbox hygiene); resolving ALSO hands the session back
//                                to the AI (handedOff=false + {type:"resume"} broadcast).
//                                A new LIVE visitor message un-resolves automatically
//                                but does NOT re-hand-off (the bot answers).
//
// Silence hand-back: a visitor message on a handed-off session arms the DO alarm
// (HANDBACK_SILENCE_MINUTES, default 5). An operator reply disarms it. If it fires,
// the session hands back to the AI so a returning visitor never faces a muted bot.
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

// ── message ring buffer (operator-app thread read + inbox preview) ───────────
// The last RING_MAX turns of the session, mirrored here by the Worker (visitor msg,
// AI reply) and by the /operator path (operator reply) — so the Buttr app can read a
// thread with zero Telegram round-trips.
// ponytail: 20-msg ceiling; add pagination only when a thread needs scroll-back
export const RING_MAX = 20;
export interface RingMsg {
  role: "visitor" | "ai" | "operator";
  text: string;
  ts: number;
}

// ── silence hand-back (DO alarm) ─────────────────────────────────────────────
// Operator silence after a visitor message on a handed-off session → hand back to
// the AI. Minutes are env-tunable (HANDBACK_SILENCE_MINUTES); this is the default.
export const HANDBACK_SILENCE_MINUTES = 5;
// Bot-styled ring line appended on a silence hand-back (operator thread record).
export const HANDBACK_NOTE = "No reply from the team for a while — the AI has resumed this chat.";

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

  private async resolved(): Promise<boolean> {
    return (await this.state.storage.get<boolean>("resolved")) === true;
  }

  private async ring(): Promise<RingMsg[]> {
    return (await this.state.storage.get<RingMsg[]>("log")) ?? [];
  }

  private async appendRing(msgs: RingMsg[]): Promise<RingMsg[]> {
    const log = await this.ring();
    log.push(...msgs);
    while (log.length > RING_MAX) log.shift();
    await this.state.storage.put("log", log);
    return log;
  }

  private silenceMs(): number {
    const mins = Number(this.env.HANDBACK_SILENCE_MINUTES);
    return (Number.isFinite(mins) && mins > 0 ? mins : HANDBACK_SILENCE_MINUTES) * 60_000;
  }

  /** Hand the session back to the AI: clear handedOff, disarm the silence alarm,
   * broadcast {type:"resume"} to every socket (widget un-mutes its framing; the
   * Buttr thread sees the state flip). No-op when the bot already has the session. */
  private async handBack(opts: { note?: string } = {}): Promise<void> {
    await this.state.storage.deleteAlarm();
    if (!(await this.handedOff())) return;
    await this.state.storage.put("handedOff", false);
    if (opts.note) await this.appendRing([{ role: "ai", text: opts.note, ts: Date.now() }]);
    broadcast(this.state.getWebSockets(), { type: "resume" });
  }

  /** DO alarm — armed by a visitor message on a handed-off session, disarmed by any
   * operator reply (and by /resolve). Firing = the operator went silent → hand back.
   * The DO has ONE alarm slot; setAlarm overwrites, which is exactly the "reset the
   * countdown on each new visitor message" semantics we want. */
  async alarm(): Promise<void> {
    await this.handBack({ note: HANDBACK_NOTE });
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
      // ?role=operator tags the socket (Buttr operator app, §3d) so the DO can
      // distinguish operator sockets (state.getWebSockets("operator")). Broadcast
      // already fans every ServerEvent to every socket, so an operator socket gets
      // the full union today; the tag is what lets operator-only events exist later.
      const operator = url.searchParams.get("role") === "operator";
      this.state.acceptWebSocket(server, operator ? ["operator"] : undefined); // hibernatable — no idle billing
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

    // One combined read for the chat flow: the handoff flag + the ring, so the
    // bot's memory costs the same single subrequest /state used to.
    if (request.method === "GET" && url.pathname.endsWith("/context")) {
      const [handedOff, messages] = await Promise.all([this.handedOff(), this.ring()]);
      return Response.json({ handedOff, messages });
    }

    // One inbox-row read: handoff flag + the ring tail — halves the per-session
    // subrequests of the /api/operator/handoffs KV scan vs /state + /log.
    if (request.method === "GET" && url.pathname.endsWith("/summary")) {
      const [handedOff, resolved, log] = await Promise.all([
        this.handedOff(),
        this.resolved(),
        this.ring(),
      ]);
      const last = log[log.length - 1];
      return Response.json({
        handedOff,
        resolved,
        lastMessage: last?.text ?? null,
        ts: last?.ts ?? null,
      });
    }

    if (request.method === "GET" && url.pathname.endsWith("/log")) {
      return Response.json({ messages: await this.ring() });
    }

    if (request.method === "POST" && url.pathname.endsWith("/log")) {
      const { messages, seed } = (await request.json()) as {
        messages?: { role: RingMsg["role"]; text: string; ts?: number }[];
        seed?: boolean;
      };
      // seed=true: the Worker replays the widget's re-sent history on handoff — only
      // when the ring is still empty (per-turn appends normally beat it; the seed
      // covers sessions whose earlier turns predate the ring).
      if (seed && (await this.ring()).length > 0) {
        return Response.json({ ok: true, seeded: false });
      }
      const now = Date.now();
      const appended: RingMsg[] = (messages ?? []).map((m) => ({
        role: m.role,
        text: m.text,
        ts: m.ts ?? now,
      }));
      const log = await this.appendRing(appended);
      // A new LIVE visitor message on a resolved session un-resolves it — the
      // visitor came back, so it belongs in the inbox again. Seed replays are
      // backfill of old turns, not new activity. Un-resolving does NOT re-hand-off:
      // the bot answers, and the visitor can re-request a human normally.
      if (!seed && appended.some((m) => m.role === "visitor")) {
        if (await this.resolved()) await this.state.storage.put("resolved", false);
        // Handed-off + visitor waiting → arm (or reset) the silence hand-back alarm.
        // Any operator reply disarms it (see /operator).
        if (await this.handedOff()) {
          await this.state.storage.setAlarm(Date.now() + this.silenceMs());
        }
      }
      // Mirror LIVE visitor/AI turns to operator sockets so an open Buttr thread
      // streams in realtime (§3d/§6). Seed replays are backfill (the app reads
      // them via /log) and visitor sockets are untouched — they'd echo the
      // visitor's own text back at them.
      if (!seed) {
        const operators = this.state.getWebSockets("operator");
        for (const m of appended) {
          if (m.role === "operator") continue; // operator replies broadcast via /operator
          broadcast(operators, { type: "message", role: m.role, text: m.text, ts: m.ts });
        }
      }
      return Response.json({ ok: true, size: log.length });
    }

    if (request.method === "POST" && url.pathname.endsWith("/operator")) {
      const { text } = (await request.json()) as { text: string };
      await this.state.storage.put("handedOff", true);
      await this.state.storage.deleteAlarm(); // the operator replied — disarm the silence hand-back
      await this.appendRing([{ role: "operator", text, ts: Date.now() }]);
      const n = broadcast(this.state.getWebSockets(), { type: "operator", text });
      return Response.json({ ok: true, delivered: n });
    }

    // Toggle the resolved flag (operator "done with this one" — inbox hygiene).
    // Toggling (not one-way set) lets the app undo an accidental swipe; a body of
    // { resolved: boolean } force-sets instead (the Telegram /done path — a repeat
    // /done must never accidentally un-resolve). Resolving = hand back to the AI.
    // Un-resolving (undo) does NOT re-hand-off — an operator reply re-takes over.
    if (request.method === "POST" && url.pathname.endsWith("/resolve")) {
      const body = (await request.json().catch(() => null)) as { resolved?: boolean } | null;
      const next = typeof body?.resolved === "boolean" ? body.resolved : !(await this.resolved());
      await this.state.storage.put("resolved", next);
      if (next) await this.handBack();
      return Response.json({ ok: true, resolved: next });
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
