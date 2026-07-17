/*
 * Krispy AI — embeddable live-chat widget. Dependency-free, ~1 file, Shadow DOM
 * isolated (host-page CSS can't leak in). Talks to @krispy/edge:
 *   POST /api/chat            → instant AI reply
 *   WS   /api/session/:id/ws  → live operator replies (bot goes silent on handoff)
 *   POST /api/contact         → [!HANDOFF] contact capture
 *
 * Embed (one line):
 *   <script src="https://YOUR-HOST/widget.js"
 *           data-api="https://krispy-edge.YOU.workers.dev"
 *           data-tenant="self" async></script>
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var cfg = {
    api: ((script && script.getAttribute("data-api")) || "").replace(/\/$/, ""),
    tenant: (script && script.getAttribute("data-tenant")) || "self",
    title: (script && script.getAttribute("data-title")) || "Chat with us",
    accent: (script && script.getAttribute("data-accent")) || "#e39a2b",
  };
  if (!cfg.api) return console.error("[krispy] missing data-api on <script>");

  // Real Buttr mark — the background-removed mascot PNG shipped NEXT TO widget.js
  // on the widget CDN (founder-approved public asset). Derived from the script src
  // so it works on any host; the inline SVG data-URI below stays as the fallback.
  var ASSET_BASE = script && script.src ? script.src.slice(0, script.src.lastIndexOf("/") + 1) : "";
  var BUTTR_PNG = ASSET_BASE ? ASSET_BASE + "buttr.png" : "";

  // Default Buttr avatar — inline data-URI (self-contained; NEVER the private
  // ops/brand/stickers PNGs). A tiny croissant on cream, in brand gold/espresso.
  var BUTTR =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='16'%20fill='%23fbf6ee'/%3E%3Cg%20transform='translate(16%2017)'%3E%3Cellipse%20cx='0'%20cy='0'%20rx='9'%20ry='5.5'%20fill='%23e39a2b'%20stroke='%23241a12'%20stroke-width='1.3'/%3E%3Cpath%20d='M-9%200%20C-7-6%200-9%209%200'%20fill='none'%20stroke='%23241a12'%20stroke-width='1.3'%20stroke-linecap='round'/%3E%3Cpath%20d='M-6-1%20C-4-3%200-4%204-2'%20fill='none'%20stroke='%23c9841c'%20stroke-width='0.9'%20stroke-linecap='round'%20opacity='0.7'/%3E%3Ccircle%20cx='-7.5'%20cy='0.5'%20r='2.5'%20fill='%23f6d9a8'%20stroke='%23241a12'%20stroke-width='1.1'/%3E%3Ccircle%20cx='7.5'%20cy='0.5'%20r='2.5'%20fill='%23f6d9a8'%20stroke='%23241a12'%20stroke-width='1.1'/%3E%3C/g%3E%3C/svg%3E";

  // Sanitizers at the CSS trust boundary — a tenant-controlled string is about to
  // land in a stylesheet, so anything that isn't a plain color/number/font is dropped.
  function clampColor(v) {
    return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$|^rgb/.test(v) ? v : null;
  }
  function clampRadius(v) {
    return typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(20, v)) : null;
  }
  function clampFont(v) {
    return typeof v === "string" && v && !/[;}<>]/.test(v) ? v : null;
  }
  // theme.glowColor hex → "r,g,b" for the rgba() glow stops. Bad input = no glow.
  function hexToRgb(v) {
    var m = typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
    if (!m) return null;
    var s = m[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }
  // Shared avatar gate (mirrored as isRenderableAvatar() in the cloud libs/ui):
  // "buttr" sentinel, an https URL, or a data:image/ URI — anything else keeps
  // the default. The avatar IS the logo: header AND floating launcher badge.
  function isRenderableAvatar(v) {
    if (typeof v !== "string") return null;
    if (v === "buttr") return BUTTR;
    return v.startsWith("https://") || v.startsWith("data:image/") ? v : null;
  }

  // Stable per-visitor session id.
  var KEY = "krispy_session_" + cfg.tenant;
  var sessionId = localStorage.getItem(KEY);
  if (!sessionId) {
    sessionId =
      (crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem(KEY, sessionId);
  }

  var history = []; // {role, content} — sent for context, capped server-side

  // Transcript persistence (adimoyal HelpChat pattern): conversational bubbles
  // survive a page refresh. Stored per-tenant; capped; sys lines + typing dots
  // are transient and never stored. Restored bubbles replay through add() so
  // they keep the same XSS-safe rendering path.
  var MSG_KEY = "krispy_msgs_" + cfg.tenant;
  var savedMsgs = [];
  try {
    savedMsgs = JSON.parse(localStorage.getItem(MSG_KEY) || "[]") || [];
  } catch {
    savedMsgs = [];
  }
  var restoring = false;
  function persistMsg(cls, text) {
    savedMsgs.push({ c: cls, t: String(text) });
    if (savedMsgs.length > 60) savedMsgs = savedMsgs.slice(-60);
    try {
      localStorage.setItem(MSG_KEY, JSON.stringify(savedMsgs));
    } catch {
      /* quota/private mode — chat still works, just not persistent */
    }
  }
  // Rebuild the AI context from the restored transcript (me→user, bot/op→assistant).
  for (var hi = Math.max(0, savedMsgs.length - 10); hi < savedMsgs.length; hi++) {
    var hm = savedMsgs[hi];
    if (hm && (hm.c === "me" || hm.c === "bot" || hm.c === "op"))
      history.push({ role: hm.c === "me" ? "user" : "assistant", content: hm.t });
  }
  var handedOff = false; // a human took over → hide the AI framing
  var ws = null;
  var keepalive = null;
  var wsBackoff = 3000; // reconnect delay, exponential up to WS_BACKOFF_MAX (with jitter)
  var WS_BACKOFF_MAX = 30000;

  // ── UI (Shadow DOM) ─────────────────────────────────────────────────────
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:20px;right:20px;left:auto;z-index:2147483000";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  // Theme lives in :host custom properties → defaults render with NO fetch; the
  // boot fetch only overrides them. Colors reference cfg.accent so data-accent
  // still works as a pre-fetch default.
  root.innerHTML =
    "<style>" +
    // ── Design tokens (krispy boulangerie palette) ──
    ":host{" +
    "--k-primary:" +
    cfg.accent +
    ";" +
    // launcher badge circle — transparent by default (theme.launcherColor fills it)
    "--k-launcher:transparent;" +
    "--k-radius:12px;" +
    "--k-font:Inter,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    // Palette
    "--k-cream:#fbf6ee;" +
    "--k-card:#fffdf9;" +
    "--k-espresso:#241a12;" +
    "--k-gold:#e39a2b;" +
    "--k-gold-hover:#c9841c;" +
    "--k-butter:#f6d9a8;" +
    "--k-crust:#9e5a22;" +
    "--k-muted:#f3ece0;" +
    "--k-muted-fg:#6b5d4f;" +
    "--k-border:#eadfcf;" +
    "--k-jam:#f0426b;" +
    "--k-pistachio:#2fbf9e;" +
    "--k-pistachio-bg:#e7f7f2;" +
    "--k-pistachio-border:#a8e3d4;" +
    "--k-pistachio-text:#0d7560" +
    "}" +
    "*{box-sizing:border-box;font-family:var(--k-font)}" +
    // ── Launcher button ──
    ".btn{position:relative;margin-left:auto;width:76px;height:76px;border:0;background:transparent;cursor:pointer;padding:0;margin-bottom:env(safe-area-inset-bottom,0);display:flex;align-items:center;justify-content:center}" +
    ".btn:active .bic{transform:scale(0.96)}" +
    ".btn .bic{width:72px;height:72px;object-fit:contain;flex:0 0 auto;pointer-events:none;border-radius:50%;background:var(--k-launcher);filter:drop-shadow(0 6px 12px rgba(36,26,18,.28));transition:transform .18s cubic-bezier(.16,1,.3,1)}" +
    ".btn:hover .bic{transform:scale(1.08) rotate(-6deg)}" +
    "@media (prefers-reduced-motion:reduce){.btn:hover .bic{transform:none}}" +
    // Unread dot (jam)
    ".btn .dot{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--k-jam);border:2px solid #fff;display:none}" +
    ".btn.kunread .dot{display:block}" +
    // Online dot (pistachio) — always shows on launcher
    ".btn .online{position:absolute;bottom:1px;right:1px;width:11px;height:11px;border-radius:50%;background:var(--k-pistachio);border:2px solid #fff}" +
    // Knudge pulse animation (0.5s ×3 — field-proven incoming-message pulse)
    "@keyframes kpulse{0%,100%{transform:scale(1)}30%{transform:scale(1.12)}60%{transform:scale(.96)}}" +
    ".btn.knudge{animation:kpulse .5s ease-in-out 3}" +
    "@media (prefers-reduced-motion:reduce){.btn.knudge{animation:none}}" +
    // ── Opt-in launcher effects — every class below is only ever ADDED when its
    // theme knob is set (kpop ← timing.launcherDelayMs, kglow ← theme.glowColor,
    // ksparkle ← theme.sparkle); an unthemed widget never gains any of them.
    ".btn.khidden{display:none}" +
    // Entrance pop (field-proven 0.6s curve; plays once after launcherDelayMs)
    "@keyframes kpop{0%{transform:scale(0) rotate(-12deg)}60%{transform:scale(1.15) rotate(3deg)}80%{transform:scale(.95)}100%{transform:scale(1)}}" +
    ".btn.kpop .bic{animation:kpop .6s cubic-bezier(.22,1,.36,1) both}" +
    // Glow — rgba stops on --k-glow ("r,g,b" from theme.glowColor); the opacity
    // stops are design constants (base .4/.2/.3, hover swell .7/.35/.5)
    ".btn.kglow .bic{box-shadow:0 0 18px rgba(var(--k-glow),.4),0 0 36px rgba(var(--k-glow),.2),0 4px 14px rgba(var(--k-glow),.3)}" +
    ".btn.kglow:hover .bic{transform:scale(1.08);box-shadow:0 0 24px rgba(var(--k-glow),.7),0 0 48px rgba(var(--k-glow),.35),0 6px 18px rgba(var(--k-glow),.5)}" +
    ".btn.kglow:active .bic{transform:scale(.96)}" +
    // Sparkle — 10s loop, 3s active / 7s idle: shadow swell + conic ring sweep
    "@keyframes kswell{0%,30%,100%{box-shadow:0 0 18px rgba(var(--k-glow),.4),0 0 36px rgba(var(--k-glow),.2),0 4px 14px rgba(var(--k-glow),.3)}15%{box-shadow:0 0 28px rgba(var(--k-glow),.8),0 0 56px rgba(var(--k-glow),.4),0 6px 20px rgba(var(--k-glow),.6)}}" +
    ".btn.ksparkle .bic{animation:kswell 10s ease-in-out infinite}" +
    "@keyframes kring{0%{opacity:0;transform:rotate(0)}10%,25%{opacity:1}30%{opacity:0;transform:rotate(360deg)}100%{opacity:0}}" +
    ".btn.ksparkle::after{content:'';position:absolute;inset:2px;border-radius:50%;pointer-events:none;opacity:0;background:conic-gradient(from 0deg,transparent,rgba(var(--k-glow),.8) 12%,transparent 30%);-webkit-mask:radial-gradient(closest-side,transparent 80%,#000 82%);mask:radial-gradient(closest-side,transparent 80%,#000 82%);animation:kring 10s linear infinite}" +
    "@media (prefers-reduced-motion:reduce){.btn.kpop .bic,.btn.ksparkle .bic,.btn.ksparkle::after{animation:none}.btn.kglow:hover .bic{transform:none}}" +
    // ── Panel ──
    ".panel{" +
    "display:none;flex-direction:column;" +
    "width:380px;max-width:calc(100vw - 5.5rem);" +
    "height:520px;max-height:min(560px,80dvh,var(--kvvh,100dvh));" +
    "background:var(--k-card);" +
    "border-radius:var(--k-radius);" +
    "overflow:hidden;" +
    "box-shadow:0 24px 56px rgba(36,26,18,.18),0 4px 16px rgba(36,26,18,.10),0 0 0 1px var(--k-border);" +
    "border:1px solid var(--k-border)" +
    "}" +
    "@keyframes kslide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}" +
    ".panel.open{display:flex;animation:kslide .22s cubic-bezier(.16,1,.3,1)}" +
    "@media (prefers-reduced-motion:reduce){.panel.open{animation:none}}" +
    // ── Header (.hd) — warm cream surface, not flat gold bar ──
    ".hd{" +
    "background:var(--k-card);" +
    "border-bottom:1px solid var(--k-border);" +
    "padding:14px 16px 12px;" +
    "display:flex;align-items:center;gap:10px;" +
    "flex-shrink:0" +
    "}" +
    // Avatar circle (Buttr mark)
    ".hd .av{" +
    "width:36px;height:36px;border-radius:50%;" +
    "flex:0 0 auto;object-fit:cover;" +
    "border:1.5px solid var(--k-border);" +
    "background:var(--k-butter)" +
    "}" +
    // Title + status block
    ".hd .ttl-wrap{flex:1;min-width:0}" +
    ".hd .ttl{" +
    "display:block;" +
    "font-family:'Fraunces',Georgia,'Times New Roman',serif;" +
    "font-size:15px;font-weight:600;" +
    "color:var(--k-espresso);" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
    "line-height:1.2" +
    "}" +
    ".hd .sub{" +
    "display:flex;align-items:center;gap:5px;" +
    "font-size:11px;color:var(--k-muted-fg);" +
    "margin-top:2px;line-height:1" +
    "}" +
    // Pistachio pulse dot in status line
    ".hd .sub .pdot{" +
    "display:inline-block;width:7px;height:7px;" +
    "border-radius:50%;background:var(--k-pistachio);flex:0 0 auto" +
    "}" +
    "@keyframes kpdot{0%,100%{opacity:1}50%{opacity:.35}}" +
    ".hd .sub .pdot{animation:kpdot 2.4s ease-in-out infinite}" +
    "@media (prefers-reduced-motion:reduce){.hd .sub .pdot{animation:none}}" +
    // Mute button (icon-only)
    ".hd .mute{" +
    "cursor:pointer;background:none;border:0;" +
    "color:var(--k-muted-fg);padding:4px;" +
    "border-radius:6px;line-height:1;font-size:15px;" +
    "transition:color 0.15s,background 0.15s;flex-shrink:0" +
    "}" +
    ".hd .mute:hover{background:var(--k-muted);color:var(--k-espresso)}" +
    // Close button
    ".hd .x{" +
    "cursor:pointer;background:none;border:0;" +
    "color:var(--k-muted-fg);padding:4px;" +
    "border-radius:6px;line-height:1;font-size:20px;" +
    "transition:color 0.15s,background 0.15s;flex-shrink:0;display:flex;align-items:center;justify-content:center" +
    "}" +
    ".hd .x:hover{background:var(--k-muted);color:var(--k-espresso)}" +
    // ── Message log (.log) ──
    ".log{" +
    "flex:1;overflow-y:auto;padding:16px 14px;" +
    "display:flex;flex-direction:column;gap:10px;" +
    "background:var(--k-cream);" +
    // Subtle scrollbar
    "scrollbar-width:thin;scrollbar-color:var(--k-border) transparent" +
    "}" +
    ".log::-webkit-scrollbar{width:4px}" +
    ".log::-webkit-scrollbar-track{background:transparent}" +
    ".log::-webkit-scrollbar-thumb{background:var(--k-border);border-radius:4px}" +
    // ── Message bubbles ──
    ".msg{" +
    "max-width:82%;padding:10px 14px;" +
    "font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;" +
    "position:relative" +
    "}" +
    // Visitor bubble (primary — defaults to brand gold, right-aligned)
    ".me{" +
    "align-self:flex-end;" +
    "background:var(--k-primary);color:var(--k-espresso);" +
    "border-radius:16px 16px 4px 16px;" +
    "box-shadow:0 1px 4px rgba(36,26,18,.10)" +
    "}" +
    // Bot bubble (card/white, left-aligned)
    ".bot{" +
    "align-self:flex-start;" +
    "background:var(--k-card);color:var(--k-espresso);" +
    "border:1px solid var(--k-border);" +
    "border-radius:16px 16px 16px 4px;" +
    "box-shadow:0 1px 4px rgba(36,26,18,.07)" +
    "}" +
    // Operator/human bubble (pistachio-tinted, left-aligned)
    ".op{" +
    "align-self:flex-start;" +
    "background:var(--k-pistachio-bg);color:var(--k-pistachio-text);" +
    "border:1px solid var(--k-pistachio-border);" +
    "border-radius:16px 16px 16px 4px;" +
    "box-shadow:0 1px 4px rgba(47,191,158,.10)" +
    "}" +
    // Inline code in bubbles
    ".msg code{" +
    "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
    "font-size:.88em;background:rgba(36,26,18,.07);padding:1px 5px;border-radius:4px" +
    "}" +
    ".msg a{color:inherit;text-decoration:underline;text-underline-offset:2px}" +
    // System text (centered, muted)
    ".sys{" +
    "align-self:center;font-size:11px;color:var(--k-muted-fg);" +
    "text-align:center;padding:0 8px;max-width:90%" +
    "}" +
    // Bubble enter animation
    "@keyframes kmsg{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}" +
    ".msg{animation:kmsg .2s cubic-bezier(.16,1,.3,1) both}" +
    "@media (prefers-reduced-motion:reduce){.msg{animation:none}}" +
    // ── Typing indicator (three bouncing dots) ──
    "@keyframes kbounce{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-5px);opacity:1}}" +
    ".typing{" +
    "align-self:flex-start;" +
    "background:var(--k-card);border:1px solid var(--k-border);" +
    "border-radius:16px 16px 16px 4px;" +
    "padding:10px 14px;display:flex;gap:4px;align-items:center;" +
    "box-shadow:0 1px 4px rgba(36,26,18,.07)" +
    "}" +
    ".typing span{" +
    "display:inline-block;width:7px;height:7px;border-radius:50%;" +
    "background:var(--k-muted-fg);" +
    "animation:kbounce 1.2s ease-in-out infinite" +
    "}" +
    ".typing span:nth-child(2){animation-delay:.2s}" +
    ".typing span:nth-child(3){animation-delay:.4s}" +
    "@media (prefers-reduced-motion:reduce){.typing span{animation:none;opacity:.6}}" +
    // ── Composer (.ft) ──
    ".ft{" +
    "display:flex;border-top:1px solid var(--k-border);" +
    "padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0));" +
    "gap:8px;align-items:center;background:var(--k-card);flex-shrink:0" +
    "}" +
    ".ft input{" +
    "flex:1;border:1.5px solid var(--k-border);" +
    "border-radius:22px;" +
    "padding:9px 14px;font-size:16px;outline:none;" +
    "background:var(--k-cream);color:var(--k-espresso);" +
    "transition:border-color 0.15s,box-shadow 0.15s;" +
    "line-height:1.4" +
    "}" +
    ".ft input::placeholder{color:var(--k-muted-fg)}" +
    ".ft input:focus{" +
    "border-color:var(--k-primary);" +
    "box-shadow:0 0 0 3px var(--k-ring,rgba(227,154,43,.15));" +
    "background:var(--k-card)" +
    "}" +
    // Send button — primary circle (brand gold by default) with paper-plane SVG
    ".ft button{" +
    "flex:0 0 auto;width:38px;height:38px;border:0;" +
    "background:var(--k-primary);color:var(--k-espresso);" +
    "border-radius:50%;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;" +
    "transition:background 0.15s,transform 0.1s,box-shadow 0.15s;" +
    "box-shadow:0 2px 8px rgba(227,154,43,.35)" +
    "}" +
    ".ft button:hover{background:var(--k-gold-hover);box-shadow:0 4px 12px rgba(201,132,28,.4);transform:translateY(-1px)}" +
    ".ft button:active{transform:translateY(0)}" +
    ".ft button:disabled{opacity:.45;cursor:default;transform:none;box-shadow:none}" +
    ".ft button svg{width:17px;height:17px;flex:0 0 auto}" +
    // ── Lead-form card (.cap) — lives INSIDE .log so it scrolls with the
    // transcript like a bubble (never a sticky band between log and composer) ──
    ".cap{" +
    "align-self:flex-start;width:100%;max-width:88%;" +
    "padding:12px 14px;background:var(--k-card);" +
    "border:1px solid var(--k-border);" +
    "border-radius:var(--k-radius);" +
    "box-shadow:0 1px 4px rgba(36,26,18,.07);" +
    "display:flex;flex-direction:column;gap:8px;flex-shrink:0;" +
    "animation:kmsg .2s cubic-bezier(.16,1,.3,1) both" +
    "}" +
    "@media (prefers-reduced-motion:reduce){.cap{animation:none}}" +
    // Collapsed after submit — a compact transcript record of the capture
    ".cap.done{padding:8px 12px;font-size:12px;color:var(--k-muted-fg)}" +
    ".cap input{" +
    "border:1.5px solid var(--k-border);border-radius:8px;" +
    "padding:9px 12px;font-size:16px;background:var(--k-cream);color:var(--k-espresso);outline:none;" +
    "transition:border-color 0.15s" +
    "}" +
    ".cap input:focus{border-color:var(--k-primary)}" +
    ".cap input::placeholder{color:var(--k-muted-fg)}" +
    ".cap button{" +
    "border:0;background:var(--k-espresso);color:var(--k-cream);" +
    "border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;" +
    "font-weight:600;letter-spacing:0.02em;" +
    "transition:background 0.15s" +
    "}" +
    ".cap button:hover{background:#3d2e22}" +
    // ── Proactive popup teaser (theme.popupText) — display:none until scheduled ──
    ".pop{display:none;position:relative;max-width:260px;margin:0 0 10px auto;padding:12px 30px 12px 14px;" +
    "background:var(--k-card);border:1px solid var(--k-border);border-radius:var(--k-radius);" +
    "box-shadow:0 12px 32px rgba(36,26,18,.18),0 2px 8px rgba(36,26,18,.10);" +
    "font-size:13px;line-height:1.45;color:var(--k-espresso);cursor:pointer}" +
    "@keyframes kpopin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
    ".pop.show{display:block;animation:kpopin .35s cubic-bezier(.16,1,.3,1)}" +
    "@media (prefers-reduced-motion:reduce){.pop.show{animation:none}}" +
    ".pop .popx{position:absolute;top:4px;right:6px;background:none;border:0;cursor:pointer;color:var(--k-muted-fg);font-size:14px;line-height:1;padding:2px}" +
    ".pop .popx:hover{color:var(--k-espresso)}" +
    // ── RTL (theme.direction:"rtl") — flip bubble corners + mirror the send icon;
    // everything else follows the panel's dir=rtl automatically ──
    ".panel.rtl .me{border-radius:16px 16px 16px 4px}" +
    ".panel.rtl .bot,.panel.rtl .op,.panel.rtl .typing{border-radius:16px 16px 4px 16px}" +
    ".panel.rtl .ft button svg{transform:rotate(180deg)}" +
    // ── CTA cards (social connectors) — brand-styled links INSIDE .log, so they
    // scroll with the transcript like bubbles. Brand colors are network constants
    // (not tenant tokens); appended into one lazily-created .ctarow card. ──
    ".ctarow{align-self:stretch;display:flex;flex-direction:column;gap:8px;" +
    "animation:kmsg .2s cubic-bezier(.16,1,.3,1) both}" +
    "@media (prefers-reduced-motion:reduce){.ctarow{animation:none}}" +
    ".ctaitem{display:flex;flex-direction:column;gap:4px}" +
    ".ctacap{font-size:11px;color:var(--k-muted-fg);padding:0 2px}" +
    ".cta{display:flex;align-items:center;justify-content:center;gap:8px;" +
    "padding:10px 14px;border-radius:var(--k-radius);color:#fff;font-weight:600;" +
    "font-size:14px;text-decoration:none;transition:filter .15s,transform .1s}" +
    ".cta:hover{filter:brightness(1.06);transform:translateY(-1px)}" +
    ".cta:active{transform:translateY(0)}" +
    ".cta svg{width:18px;height:18px;flex:0 0 auto}" +
    ".cta-instagram{background:linear-gradient(90deg,#833AB4,#E1306C,#F77737)}" +
    ".cta-whatsapp{background:#25D366}" +
    ".cta-whatsapp:hover{background:#20BD5A;filter:none}" +
    ".cta-facebook{background:#1877F2}" +
    ".cta-tiktok{background:#010101}" +
    // phone/link fall back to the tenant's primary tint (espresso ink on gold)
    ".cta-phone,.cta-link{background:var(--k-primary);color:var(--k-espresso)}" +
    // ── Starter chips (script.starters) — suggested questions above the composer,
    // fresh conversation only; a click sends the chip text as the visitor message. ──
    ".starters{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;background:var(--k-card)}" +
    ".chip{border:1px solid var(--k-border);background:var(--k-cream);color:var(--k-espresso);" +
    "border-radius:16px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:var(--k-font);" +
    "transition:background .15s,border-color .15s}" +
    ".chip:hover{background:var(--k-muted);border-color:var(--k-primary)}" +
    "</style>" +
    // ── Panel markup ──
    '<div class="panel" part="panel">' +
    // Header: avatar + title/status + mute + close
    // Avatar shows the BUTTR mark by default; applyTheme can replace src or hide
    '<div class="hd">' +
    '<img class="av" alt="Krispy">' +
    '<div class="ttl-wrap">' +
    '<span class="ttl"></span>' +
    '<span class="sub"><span class="pdot"></span><span class="subtxt">we usually reply in minutes</span></span>' +
    "</div>" +
    '<button type="button" class="mute" aria-label="Mute notifications"></button>' +
    // Close button: inline SVG X (no innerHTML for user data — this is static chrome)
    '<button type="button" class="x" aria-label="Close chat">' +
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">' +
    '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    "</svg>" +
    "</button>" +
    "</div>" +
    '<div class="log"></div>' +
    // Composer: text input + paper-plane send button
    '<form class="ft">' +
    '<input class="in" placeholder="Type a message…" autocomplete="off">' +
    '<button type="submit" aria-label="Send message">' +
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M17 10L3 3l3.5 7L3 17l14-7z" fill="currentColor"/>' +
    "</svg>" +
    "</button>" +
    "</form>" +
    "</div>" +
    // Popup teaser card above the launcher (hidden until theme.popupText schedules it)
    '<div class="pop">' +
    '<button type="button" class="popx" aria-label="Dismiss">×</button>' +
    '<span class="popt"></span>' +
    "</div>" +
    // Launcher button: real Buttr mascot (PNG from the widget CDN, data-URI fallback)
    '<button class="btn" aria-label="Open chat">' +
    '<img class="bic" alt="">' +
    '<span class="dot"></span>' +
    '<span class="online"></span>' +
    "</button>";

  var $ = function (s) {
    return root.querySelector(s);
  };
  var panel = $(".panel"),
    log = $(".log"),
    input = $(".in"),
    sendForm = $(".ft"),
    sendBtn = sendForm.querySelector("button");
  var avatarEl = $(".av");
  var popEl = $(".pop"),
    popTxtEl = $(".popt");
  $(".ttl").textContent = cfg.title;
  // Default avatar + launcher: real Buttr PNG, inline data-URI as onerror fallback.
  var launcherIcon = $(".bic");
  function setButtr(img) {
    if (!img) return;
    img.onerror = function () {
      this.onerror = null;
      this.src = BUTTR;
    };
    img.src = BUTTR_PNG || BUTTR;
  }
  setButtr(avatarEl);
  setButtr(launcherIcon);

  // ── theme (boot fetch, init-gated, NO poll — decorative → never blocks chat) ──
  var greeting = ""; // optional first bot bubble on open; set by theme
  var soundEnabled = true; // theme.sound (tenant); default ON. AND-gated with visitor mute below.
  // WidgetTiming — field-proven UX defaults; each value only matters once its
  // parent feature is on (launcherDelayMs → entrance, sparkleAfterMs → sparkle,
  // popup* → popupText). autoOpenMs defaults 0 (= never) — neutral like every
  // other knob; the field-proven value once a tenant opts in is 2000.
  var timing = {
    launcherDelayMs: 0,
    sparkleAfterMs: 10000,
    popupDelayMs: 8000,
    popupCooldownHrs: 24,
    autoOpenMs: 0,
  };
  // ── boot data beyond theme (projected by publicWidgetConfig): CTA connectors,
  // forms, conversation script, popups. ALL default empty → nothing new shows. ──
  var ctas = []; // [{id,type,label,caption,url,showAfterMs}] — server-built https/tel hrefs
  var forms = []; // [{id,title,fields,afterReplyMs,successText}] — boot copy for the afterReplyMs fallback timer
  var opening = []; // script.opening — scripted bot bubbles on panel open (opening[0] supersedes greeting)
  var starters = []; // script.starters — suggested-question chips above the input (max 4)
  var openSource = ""; // popup "source" label — rides into the chat/lead session context when a popup opens the panel
  var ctaTimers = []; // per-CTA showAfterMs setTimeouts; cleared on operator takeover
  var formTimers = []; // FormSpec.afterReplyMs fallback timers; cleared on takeover / when any form shows
  var ctaArmed = false; // CTAs arm once, on the first visitor message
  var repliedOnce = false; // first AI reply arms the afterReplyMs form fallback
  var ctaRow = null; // lazily-created CTA-row card inside .log
  var startersEl = null; // starter-chip strip above the composer (fresh conversation only)
  var popShown = false; // a teaser card is currently visible (one at a time)
  var currentPopupSource = ""; // source of the teaser currently shown
  var popupTimers = []; // pending popup timers (timer delay + near dwell) — cleared while the panel is open
  var popupObservers = []; // near-trigger IntersectionObservers — disconnected while the panel is open
  function clampMs(v, dflt) {
    return typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(300000, v)) : dflt;
  }
  function applyTheme(th) {
    if (!th) return;
    if (th.sound === false) soundEnabled = false;
    var pc = clampColor(th.primaryColor);
    if (pc) {
      host.style.setProperty("--k-primary", pc);
      // hover keeps its lift/shadow feedback; the darker-gold shift only makes
      // sense against the default gold, so a themed primary uses itself
      host.style.setProperty("--k-gold-hover", pc);
      // input focus ring — same hue as the themed border (was hardcoded gold);
      // only when primaryColor is a hex we can alpha-blend, else keep the default
      var pcRgb = hexToRgb(th.primaryColor);
      if (pcRgb) host.style.setProperty("--k-ring", "rgba(" + pcRgb + ",.15)");
    }
    var lc = clampColor(th.launcherColor);
    if (lc) host.style.setProperty("--k-launcher", lc);
    var r = clampRadius(th.radius);
    if (r != null) host.style.setProperty("--k-radius", r + "px");
    var f = clampFont(th.font);
    if (f) host.style.setProperty("--k-font", f);
    if (th.position === "bl") {
      host.style.right = "auto";
      host.style.left = "20px";
      // bottom-left: the launcher + popup hug the left edge under the open panel
      var blBtn = root.querySelector(".btn");
      if (blBtn) {
        blBtn.style.marginLeft = "0";
        blBtn.style.marginRight = "auto";
      }
      popEl.style.marginLeft = "0";
      popEl.style.marginRight = "auto";
    }
    if (typeof th.headerTitle === "string" && th.headerTitle)
      $(".ttl").textContent = th.headerTitle;
    if (typeof th.tagline === "string" && th.tagline) $(".subtxt").textContent = th.tagline;
    if (typeof th.greeting === "string") greeting = th.greeting.trim();
    // avatar (shared gate) — brands the header AND the floating launcher badge
    var av = isRenderableAvatar(th.avatar);
    if (av) {
      avatarEl.src = av;
      launcherIcon.src = av;
    }
    if (th.direction === "rtl") {
      panel.dir = "rtl";
      panel.classList.add("rtl");
      popEl.dir = "rtl";
    }
    // timing overrides (clamped 0–300s) — inert on their own, consumed below
    var t = th.timing || {};
    timing.launcherDelayMs = clampMs(t.launcherDelayMs, 0);
    timing.sparkleAfterMs = clampMs(t.sparkleAfterMs, 10000);
    timing.popupDelayMs = clampMs(t.popupDelayMs, 8000);
    timing.autoOpenMs = clampMs(t.autoOpenMs, 0);
    timing.popupCooldownHrs =
      typeof t.popupCooldownHrs === "number" && isFinite(t.popupCooldownHrs)
        ? Math.max(0, Math.min(8760, t.popupCooldownHrs))
        : 24;
    // glow — opt-in: no glowColor (the default) → no glow layer at all
    var glow = hexToRgb(th.glowColor);
    if (glow) {
      host.style.setProperty("--k-glow", glow);
      launcher.classList.add("kglow");
    }
    // sparkle — opt-in idle loop, joins after sparkleAfterMs
    if (th.sparkle === true)
      setTimeout(function () {
        launcher.classList.add("ksparkle");
      }, timing.sparkleAfterMs);
    // delayed entrance — opt-in via launcherDelayMs>0; sessionStorage skips the
    // delay AND the pop on revisit (back-nav shouldn't re-play the entrance).
    // ponytail: the boot fetch races first paint, so the launcher may blink
    // before hiding — avoiding that would mean blocking render on config.
    var SHOWN_KEY = "krispy_btn_shown_" + cfg.tenant;
    if (timing.launcherDelayMs > 0 && !sessionStorage.getItem(SHOWN_KEY)) {
      launcher.classList.add("khidden");
      setTimeout(function () {
        launcher.classList.remove("khidden");
        launcher.classList.add("kpop");
        try {
          sessionStorage.setItem(SHOWN_KEY, "1");
        } catch {
          /* private mode — entrance just re-plays next load */
        }
      }, timing.launcherDelayMs);
    }
    // popups now flow through the unified engine (applyBoot → initPopups); a bare
    // theme.popupText degrades to a single timer popup there (popupTextSugar).
  }

  // ── boot config beyond theme (§3.5/§3.7/§4): CTAs, forms, script, popups ─────
  // ONE popup engine for timer + section-proximity triggers; theme.popupText is
  // sugar for a single timer popup. All lists default empty → nothing new shows.
  function applyBoot(c) {
    if (!c) return;
    if (Array.isArray(c.ctas)) ctas = c.ctas;
    if (Array.isArray(c.forms)) forms = c.forms;
    if (c.script) {
      if (Array.isArray(c.script.opening))
        opening = c.script.opening
          .filter(function (s) {
            return typeof s === "string" && s.trim();
          })
          .map(function (s) {
            return s.trim();
          })
          .slice(0, 5);
      if (Array.isArray(c.script.starters))
        starters = c.script.starters
          .filter(function (s) {
            return typeof s === "string" && s.trim();
          })
          .map(function (s) {
            return s.trim();
          })
          .slice(0, 4);
    }
    // c.popups is authoritative whenever the edge sends the key — an explicit []
    // means "no popups" and must NOT re-desugar a lingering theme.popupText. Only a
    // key-less config (an older edge that predates popups[]) falls back to the sugar.
    var popups = Array.isArray(c.popups) ? c.popups : popupTextSugar(c.theme);
    initPopups(popups);
  }
  // theme.popupText → a single timer popup (one engine, no parallel system).
  function popupTextSugar(th) {
    var t = th && typeof th.popupText === "string" ? th.popupText.trim() : "";
    return t
      ? [
          {
            trigger: { kind: "timer", delayMs: timing.popupDelayMs },
            text: t,
            cooldownHours: timing.popupCooldownHrs,
          },
        ]
      : [];
  }
  fetch(cfg.api + "/api/widget/config?t=" + encodeURIComponent(cfg.tenant))
    .then(function (r) {
      return r.json();
    })
    .then(function (c) {
      applyTheme(c && c.theme);
      applyBoot(c);
    })
    .catch(function () {}); // theme is decorative; chat works without it

  // ── message notifications (ding + launcher pulse + unread dot) ──────────────
  // Fires ONLY on an inbound (bot/operator) message while the panel is CLOSED.
  var MUTE_KEY = "krispy_muted_" + cfg.tenant;
  var muted = localStorage.getItem(MUTE_KEY) === "1";
  var hasInteracted = false; // autoplay policy: stay silent until first interaction
  var launcher = $(".btn"),
    muteBtn = $(".mute");

  function renderMute() {
    muteBtn.textContent = muted ? "🔇" : "🔔";
    muteBtn.setAttribute("aria-label", muted ? "Unmute notifications" : "Mute notifications");
  }
  renderMute();
  muteBtn.addEventListener("click", function () {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    renderMute();
  });

  // Popup teaser interactions: card click opens the chat (carrying the popup's
  // source into the session), × just dismisses. Cooldown is stamped at show time,
  // so either way it stays gone.
  function showPopup(text, source) {
    if (panel.classList.contains("open") || popShown) return;
    currentPopupSource = source || "";
    popTxtEl.textContent = text;
    popEl.classList.add("show");
    popShown = true;
  }
  function hidePopup() {
    popEl.classList.remove("show");
    popShown = false;
  }
  popEl.addEventListener("click", function () {
    if (currentPopupSource) openSource = currentPopupSource; // rides into chat/session context
    hidePopup();
    open();
  });
  root.querySelector(".popx").addEventListener("click", function (e) {
    e.stopPropagation(); // don't let the dismiss × open the chat
    hidePopup();
  });

  // ── Unified popup engine (§3.5) — timer + section-proximity triggers ─────────
  // "timer" {delayMs} shows after a delay; "near" {selector,dwellMs,threshold}
  // observes a host-page element via IntersectionObserver — the dwell timer starts
  // when the element is ≥threshold visible and clears when it scrolls away. Each
  // popup keeps its own cooldown key; unmatched selectors are a silent no-op; all
  // timers/observers are killed while the panel is open (see open()).
  function initPopups(popups) {
    if (!Array.isArray(popups)) return;
    popups.forEach(function (p, i) {
      if (!p || !p.trigger || typeof p.text !== "string" || !p.text.trim()) return;
      var text = p.text.trim();
      var source = typeof p.source === "string" ? p.source : "";
      var key = "krispy_popup_" + cfg.tenant + "_" + (source || i); // per-popup, never blocks siblings
      var persist = p.persist !== false; // default true → cooldown applies
      var cooldownHrs =
        typeof p.cooldownHours === "number" && isFinite(p.cooldownHours)
          ? Math.max(0, Math.min(8760, p.cooldownHours))
          : 24;
      function coolingDown() {
        if (!persist) return false; // persist:false resets every page load
        return Date.now() - (+localStorage.getItem(key) || 0) < cooldownHrs * 3600000;
      }
      function fire() {
        if (panel.classList.contains("open") || popShown || coolingDown()) return;
        showPopup(text, source);
        if (persist) {
          try {
            localStorage.setItem(key, String(Date.now()));
          } catch {
            /* quota/private mode — popup just re-shows next load */
          }
        }
      }
      var trig = p.trigger;
      if (trig.kind === "near" && typeof trig.selector === "string") {
        var el = document.querySelector(trig.selector);
        if (!el || typeof IntersectionObserver === "undefined") return; // no-op if nothing matches
        var dwellMs = clampMs(trig.dwellMs, 8000);
        var threshold =
          typeof trig.threshold === "number" && trig.threshold >= 0 && trig.threshold <= 1
            ? trig.threshold
            : 0.3;
        var dwellT = null;
        var io = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting && en.intersectionRatio >= threshold) {
                if (!dwellT) {
                  dwellT = setTimeout(fire, dwellMs);
                  popupTimers.push(dwellT);
                }
              } else if (dwellT) {
                clearTimeout(dwellT); // scrolled away before dwell elapsed
                dwellT = null;
              }
            });
          },
          { threshold: threshold },
        );
        io.observe(el);
        popupObservers.push(io);
      } else {
        // timer (default kind)
        if (coolingDown()) return;
        popupTimers.push(setTimeout(fire, clampMs(trig.delayMs, timing.popupDelayMs)));
      }
      // cancelOnClick — the visitor clicked the thing itself → dismiss + mark shown.
      if (typeof p.cancelOnClick === "string" && p.cancelOnClick) {
        document.addEventListener("click", function (e) {
          if (e.target && e.target.closest && e.target.closest(p.cancelOnClick)) {
            if (persist) {
              try {
                localStorage.setItem(key, String(Date.now()));
              } catch {
                /* ignore */
              }
            }
            hidePopup();
          }
        });
      }
    });
  }

  // WebAudio "ding" — two short oscillator notes, ~150ms. No file, no base64.
  var audioCtx = null;
  function playDing() {
    if (!soundEnabled || muted || !hasInteracted) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var now = audioCtx.currentTime;
      [
        [880, 0],
        [1174.66, 0.08],
      ].forEach(function (n) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = n[0];
        var t = now + n[1];
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } catch {
      /* audio optional */
    }
  }

  // Inbound message landed → notify only if the panel is closed.
  var autoOpenTimer = null;
  function notifyInbound() {
    if (panel.classList.contains("open")) return;
    playDing();
    launcher.classList.add("kunread");
    launcher.classList.remove("knudge");
    void launcher.offsetWidth; // restart the animation if it's mid-flight
    launcher.classList.add("knudge");
    // Auto-open: a closed panel with a fresh inbound reply opens itself after
    // timing.autoOpenMs (opt-in; default 0 = never, field-proven value 2000).
    // One pending timer max.
    if (timing.autoOpenMs > 0 && !autoOpenTimer)
      autoOpenTimer = setTimeout(function () {
        autoOpenTimer = null;
        if (!panel.classList.contains("open")) open();
      }, timing.autoOpenMs);
  }

  // First interaction unlocks audio (browser autoplay policy).
  function markInteracted() {
    hasInteracted = true;
  }
  host.addEventListener("pointerdown", markInteracted);

  // Minimal, SAFE markdown → DOM. Appends nodes to `el` via createElement/
  // textContent ONLY — NEVER innerHTML (the load-bearing XSS guard). Handles
  // **bold** __bold__, *italic* _italic_, `code`, [label](url). Unmatched or
  // unbalanced markers fall through as literal text; nothing is ever dropped.
  function safeHref(url) {
    var u = String(url).trim();
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : null; // reject javascript:, data:, etc.
  }
  function renderInline(el, text) {
    // inline markers only (no links here); newlines stay literal (pre-wrap renders them)
    var rx = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g;
    var last = 0,
      m;
    while ((m = rx.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tag, inner;
      if (m[1] != null) {
        tag = "strong";
        inner = m[2];
      } else if (m[3] != null) {
        tag = "em";
        inner = m[4];
      } else {
        tag = "code";
        inner = m[5];
      }
      var node = document.createElement(tag);
      node.textContent = inner; // never innerHTML
      el.appendChild(node);
      last = rx.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  function renderRich(el, text) {
    // links first (they may span inline markers), then inline markers on the gaps
    var rx = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    var last = 0,
      m;
    while ((m = rx.exec(text))) {
      if (m.index > last) renderInline(el, text.slice(last, m.index));
      var href = safeHref(m[2]);
      if (href) {
        var a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        renderInline(a, m[1]); // label may carry **bold** etc.
        el.appendChild(a);
      } else {
        // rejected scheme → render the whole [label](url) literally as text
        el.appendChild(document.createTextNode(m[0]));
      }
      last = rx.lastIndex;
    }
    if (last < text.length) renderInline(el, text.slice(last));
  }

  function add(cls, text) {
    // Typing indicator: return a special node with animated dots for "…" placeholder
    if (cls === "bot" && text === "…") {
      var t = document.createElement("div");
      t.className = "typing";
      // Three bouncing dot spans — purely CSS-animated, no text
      t.appendChild(document.createElement("span"));
      t.appendChild(document.createElement("span"));
      t.appendChild(document.createElement("span"));
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
      return t; // .remove() contract preserved — caller does typing.remove()
    }
    var d = document.createElement("div");
    d.className = "msg " + cls;
    // Only AI-emitted bubbles get markdown; visitor (me) + system (sys) stay
    // literal so a visitor can never inject markup.
    if (cls === "bot" || cls === "op") renderRich(d, String(text));
    else d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    if (!restoring && (cls === "me" || cls === "bot" || cls === "op")) persistMsg(cls, text);
    return d;
  }

  // ── keyboard-aware floating card (visualViewport) ───────────────────────
  var vv = window.visualViewport;
  function syncViewport() {
    if (!vv) return; // desktop / unsupported → static card
    // gap the keyboard occupies at the bottom of the layout viewport
    var kb = window.innerHeight - (vv.height + vv.offsetTop);
    host.style.bottom = Math.max(20, kb) + "px";
    host.style.setProperty("--kvvh", vv.height + "px");
  }
  if (vv) {
    vv.addEventListener("resize", syncViewport);
    vv.addEventListener("scroll", syncViewport);
  }

  // ── conversation script (§3.7) ──────────────────────────────────────────────
  // opening[]: a proactive bot-message sequence on panel open — first bubble is
  // instant (= today's greeting), the rest are separated by the existing typing
  // indicator. opening[0] supersedes theme.greeting, so a lone greeting is unchanged.
  function playOpening(seq) {
    add("bot", seq[0]);
    var i = 1;
    (function next() {
      if (i >= seq.length) return;
      var typing = add("bot", "…");
      setTimeout(function () {
        typing.remove();
        add("bot", seq[i++]);
        next();
      }, 900); // ~1s human pause between scripted bubbles
    })();
  }
  // starters[]: suggested-question chips above the composer, fresh conversation
  // only; clicking one sends it as the visitor message and removes the strip.
  function removeStarters() {
    if (startersEl) {
      startersEl.remove();
      startersEl = null;
    }
  }
  function renderStarters() {
    if (!starters.length || startersEl) return;
    startersEl = document.createElement("div");
    startersEl.className = "starters";
    starters.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = s; // textContent, never innerHTML
      chip.addEventListener("click", function () {
        sendMessage(s);
      });
      startersEl.appendChild(chip);
    });
    panel.insertBefore(startersEl, sendForm);
  }

  var opened = false;
  function open() {
    hasInteracted = true; // opening counts as interaction (unlocks audio)
    hidePopup(); // an open panel supersedes the teaser
    // Suppress popups while chatting: kill pending timers + disconnect observers.
    popupTimers.forEach(clearTimeout);
    popupTimers = [];
    popupObservers.forEach(function (o) {
      try {
        o.disconnect();
      } catch {
        /* ignore */
      }
    });
    popupObservers = [];
    panel.classList.add("open");
    launcher.classList.remove("kunread", "knudge"); // clear unread on open
    if (!opened) {
      opened = true;
      add("sys", "You're chatting with an AI assistant. A human can jump in anytime.");
      if (savedMsgs.length) {
        restoring = true;
        for (var ri = 0; ri < savedMsgs.length; ri++) {
          var rm = savedMsgs[ri];
          if (rm && rm.c && rm.t != null) add(rm.c, rm.t);
        }
        restoring = false;
      } else if (opening.length) {
        playOpening(opening); // scripted opener (opening[0] supersedes greeting)
      } else if (greeting) {
        add("bot", greeting); // today's single-greeting behavior, unchanged
      }
      if (!savedMsgs.length) renderStarters(); // fresh conversation only
      connectWs();
    }
    syncViewport();
    setTimeout(function () {
      input.focus();
    }, 60); // transitionend never fires on a display-toggle
  }
  function closePanel() {
    panel.classList.remove("open");
    input.blur();
    host.style.bottom = "20px"; // reset the keyboard pin
  }
  $(".btn").addEventListener("click", function () {
    if (panel.classList.contains("open")) closePanel();
    else open();
  });
  $(".x").addEventListener("click", closePanel);

  // ── live channel (operator replies) ─────────────────────────────────────
  function connectWs() {
    try {
      var wsUrl =
        cfg.api.replace(/^http/, "ws") +
        "/api/session/" +
        encodeURIComponent(sessionId) +
        "/ws?t=" +
        encodeURIComponent(cfg.tenant);
      ws = new WebSocket(wsUrl);
      ws.onmessage = function (e) {
        if (e.data === "pong") return;
        var ev;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        if (ev.type === "ready") {
          handedOff = !!ev.handedOff;
          if (handedOff) markHuman();
        } else if (ev.type === "operator") {
          handedOff = true;
          markHuman();
          add("op", ev.text);
          notifyInbound();
        } else if (ev.type === "handoff") {
          showForm(DEFAULT_CONTACT_FORM);
        } else if (ev.type === "resume") {
          // The AI took the session back (operator resolved it or went quiet).
          // Reset the human framing so a later takeover announces itself again.
          handedOff = false;
          humanMarked = false;
          add("sys", "You're back with the AI assistant. A human can rejoin anytime.");
        }
      };
      ws.onclose = function () {
        // Exponential backoff capped at WS_BACKOFF_MAX, ±25% jitter (avoid a
        // thundering-herd reconnect when the edge recovers). Reset on open.
        var delay = wsBackoff * (0.75 + Math.random() * 0.5);
        wsBackoff = Math.min(wsBackoff * 2, WS_BACKOFF_MAX);
        setTimeout(connectWs, delay);
      }; // reconnect
      // keepalive so proxies don't idle-close (hibernation-friendly)
      ws.onopen = function () {
        wsBackoff = 3000; // healthy again — reset the backoff
        clearInterval(keepalive);
        keepalive = setInterval(function () {
          try {
            ws.send("ping");
          } catch {
            /* closing */
          }
        }, 30000);
      };
    } catch {
      /* WS optional; POST still works */
    }
  }

  var humanMarked = false;
  function markHuman() {
    if (humanMarked) return;
    humanMarked = true;
    add("sys", "A team member has joined the chat.");
    clearFallbacks(); // a human is engaged → CTA/form escape hatches are now noise
  }
  // Clear all fallback timers (CTA stagger + afterReplyMs form) on operator takeover
  // — mirrors "real operator reply hides fallback CTAs/form".
  function clearFallbacks() {
    ctaTimers.forEach(clearTimeout);
    ctaTimers = [];
    formTimers.forEach(clearTimeout);
    formTimers = [];
  }

  // ── contact capture (on [!HANDOFF] with no form) ────────────────────────
  // One renderer, one door: the legacy hardcoded .cap markup is gone — handoff
  // without a tenant form renders this default FormSpec through showForm(),
  // posting /api/lead like every other form (/api/contact stays an edge shim
  // for already-deployed widgets).
  var DEFAULT_CONTACT_FORM = {
    id: "contact",
    title: "Leave your contact",
    fields: [
      { name: "name", label: "Your name", type: "text" },
      { name: "contact", label: "Email or phone", type: "text", required: true },
    ],
  };

  // ── CTA engine (§4) — social-connector cards inside .log ─────────────────────
  // Armed on the FIRST visitor message; each CTA renders once after its own
  // showAfterMs (staggered) into a lazily-created .ctarow card that scrolls with
  // the transcript. Server projects only cta!==false connectors with https/tel
  // hrefs + default labels; form.connectorIds scoping stays server-side. All
  // timers are cleared on operator takeover (clearFallbacks).
  var DEFAULT_CTA_LABEL = {
    whatsapp: "Chat on WhatsApp",
    instagram: "DM us on Instagram",
    facebook: "Find us on Facebook",
    tiktok: "Follow on TikTok",
    phone: "Call us",
    link: "Visit us",
  };
  // Static per-type brand glyphs (constant SVG, NOT tenant data — safe to inject
  // as innerHTML, same pattern as the send/close chrome icons above).
  var CTA_GLYPH = {
    instagram:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 2a8 8 0 11-4.2 14.8l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0112 4zm4.3 10.6c-.2.5-1.2 1-1.6 1-.4.1-.9.2-2.9-.6-2.4-1-3.9-3.5-4-3.7-.1-.2-.9-1.2-.9-2.3 0-1.1.6-1.6.8-1.8.2-.2.4-.3.6-.3h.4c.2 0 .4 0 .6.5l.7 1.7c0 .2.1.3 0 .5l-.3.5-.3.3c-.2.1-.3.3-.1.6.1.2.7 1 1.4 1.6.9.8 1.6 1 1.9 1.2.2.1.4 0 .5-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.5.3.1.2.1.6-.1 1z"/></svg>',
    facebook:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9h2.5l.5-3H14V4.3c0-.8.3-1.3 1.5-1.3H17V.3C16.6.2 15.6 0 14.5 0 12 0 11 1.5 11 4v2H8.5v3H11v9h3V9z"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3c.3 2 1.6 3.5 3.5 3.8v2.6c-1.3 0-2.5-.4-3.5-1.1v5.4a5.4 5.4 0 11-5.4-5.4c.3 0 .5 0 .8.1v2.7a2.7 2.7 0 102 2.6V3H16z"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"/></svg>',
  };
  function ctaContainer() {
    if (!ctaRow || !ctaRow.isConnected) {
      ctaRow = document.createElement("div");
      ctaRow.className = "ctarow";
      log.appendChild(ctaRow);
    }
    return ctaRow;
  }
  function renderCta(c) {
    if (!c || typeof c.url !== "string") return;
    if (!/^(https:\/\/|tel:)/i.test(c.url)) return; // only https/wa.me/tel hrefs render
    var item = document.createElement("div");
    item.className = "ctaitem";
    if (typeof c.caption === "string" && c.caption) {
      var cap = document.createElement("div");
      cap.className = "ctacap";
      cap.textContent = c.caption; // textContent, never innerHTML
      item.appendChild(cap);
    }
    var a = document.createElement("a");
    a.className = "cta cta-" + (c.type || "link");
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    var glyph = CTA_GLYPH[c.type];
    if (glyph) {
      var gs = document.createElement("span");
      gs.className = "ctaglyph";
      gs.style.cssText = "display:flex";
      gs.innerHTML = glyph; // static brand constant — not tenant data
      a.appendChild(gs);
    }
    var lbl = document.createElement("span");
    lbl.textContent = c.label || DEFAULT_CTA_LABEL[c.type] || "Contact us";
    a.appendChild(lbl);
    item.appendChild(a);
    ctaContainer().appendChild(item);
    log.scrollTop = log.scrollHeight;
  }
  function armCtas() {
    ctaArmed = true;
    ctas.forEach(function (c) {
      if (!c) return;
      ctaTimers.push(
        setTimeout(
          function () {
            if (handedOff) return; // operator took over before this CTA fired
            renderCta(c);
          },
          clampMs(c.showAfterMs, 0),
        ),
      );
    });
  }
  // afterReplyMs form fallback (§4): after the first AI reply, any form carrying
  // afterReplyMs arms a one-shot showForm timer — cancelled by [!FORM] (showForm
  // clears formTimers), by another form already showing, or by operator takeover.
  function armFormFallback() {
    forms.forEach(function (f) {
      var ms = f && clampMs(f.afterReplyMs, 0);
      if (f && ms > 0)
        formTimers.push(
          setTimeout(function () {
            if (!formOpen && !handedOff) showForm(f);
          }, ms),
        );
    });
  }

  // ── data-driven lead form (on [!FORM:<id>], carried by res.form) ─────────
  // Built entirely with createElement/textContent — NEVER innerHTML for any value
  // (form fields, options, CTA labels/urls are all tenant/visitor-controlled → XSS).
  var formOpen = false;
  function showForm(form) {
    if (formOpen || !form || !form.fields) return;
    formOpen = true;
    // any form showing cancels the afterReplyMs fallback (incl. a [!FORM] trigger)
    formTimers.forEach(clearTimeout);
    formTimers = [];
    var wrap = document.createElement("form");
    wrap.className = "cap";

    if (form.title) {
      var h = document.createElement("div");
      h.style.cssText = "font-weight:600;font-size:14px;color:#241a12";
      h.textContent = form.title;
      wrap.appendChild(h);
    }

    var inputs = {}; // name → element
    form.fields.forEach(function (f) {
      if (!f || !f.name) return;
      var el;
      if (f.type === "textarea") {
        el = document.createElement("textarea");
        el.rows = 3;
      } else if (f.type === "select") {
        el = document.createElement("select");
        (f.options || []).forEach(function (opt) {
          var o = document.createElement("option");
          o.value = opt;
          o.textContent = opt; // textContent, never innerHTML
          el.appendChild(o);
        });
      } else {
        el = document.createElement("input");
        el.type = f.type === "email" || f.type === "tel" ? f.type : "text";
      }
      el.style.fontSize = "16px"; // shared constraint w/ Feature C — <16px = iOS zoom
      if (f.label && el.tagName !== "SELECT") el.placeholder = f.label;
      if (f.required) el.required = true;
      inputs[f.name] = el;
      wrap.appendChild(el);
    });

    var submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Send";
    wrap.appendChild(submit);

    // CTA connectors (whatsapp/instagram) → <a> links, attached to res.form.
    (form.ctas || []).forEach(function (c) {
      var href =
        c.type === "whatsapp" && c.phone
          ? "https://wa.me/" + encodeURIComponent(c.phone)
          : c.type === "instagram" && c.profileUrl
            ? c.profileUrl
            : null;
      if (!href || !href.startsWith("https://")) return; // only https links render
      var a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = c.type === "whatsapp" ? "WhatsApp" : "Instagram";
      a.style.cssText =
        "text-align:center;padding:8px;border:1px solid #ddd;border-radius:8px;color:#241a12;text-decoration:none;font-size:14px";
      wrap.appendChild(a);
    });

    wrap.addEventListener("submit", function (e) {
      e.preventDefault();
      var values = {};
      Object.keys(inputs).forEach(function (name) {
        values[name] = inputs[name].value.trim();
      });
      fetch(cfg.api + "/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: cfg.tenant,
          sessionId: sessionId,
          formId: form.id,
          values: values,
          history: history.slice(-10),
          source: openSource || undefined, // popup origin → lead meta (§3.5)
        }),
      }).catch(function () {});
      // Collapse in place to a compact transcript record — the card stays in
      // the log as proof the details were sent (textContent clears the fields).
      wrap.textContent = form.successText || "Thanks — we'll be in touch.";
      wrap.classList.add("done");
      formOpen = false;
    });

    log.appendChild(wrap); // into the log — scrolls with the transcript, never a sticky band
    wrap.scrollIntoView({ block: "nearest" });
  }

  // ── send ─────────────────────────────────────────────────────────────────
  // Extracted so starter chips (§3.7) can send too — a chip click IS a visitor
  // message. The FIRST visitor message arms the CTA stagger (§4).
  function sendMessage(text) {
    text = (text || "").trim();
    if (!text) return;
    removeStarters(); // suggested chips are for the empty state only
    add("me", text);
    history.push({ role: "user", content: text });
    if (!ctaArmed && ctas.length) armCtas(); // first visitor message arms CTAs
    sendBtn.disabled = true;
    var typing = handedOff ? null : add("bot", "…");
    // 30s guard: a hung request (e.g. mid-deploy) must never leave typing dots
    // forever — abort → the catch shows the retry line.
    var chatAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    var chatTimer =
      chatAbort &&
      setTimeout(function () {
        chatAbort.abort();
      }, 30000);
    fetch(cfg.api + "/api/chat", {
      method: "POST",
      signal: chatAbort ? chatAbort.signal : undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        tenantId: cfg.tenant,
        message: text,
        history: history.slice(-10),
        source: openSource || undefined, // popup origin → session context (§3.5)
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (typing) typing.remove();
        if (res.handedOff) {
          handedOff = true;
          markHuman();
          return;
        } // human owns it — stay silent
        if (res.reply) {
          add(res.degraded ? "op" : "bot", res.reply);
          history.push({ role: "assistant", content: res.reply });
          notifyInbound(); // self-gates: no-op while panel open
          if (!repliedOnce && !handedOff) {
            repliedOnce = true;
            armFormFallback(); // first AI reply → afterReplyMs form timer (§4)
          }
        }
        if (res.form) showForm(res.form);
        else if (res.handoff) showForm(DEFAULT_CONTACT_FORM);
      })
      .catch(function () {
        if (typing) typing.remove();
        add("sys", "Connection issue — please try again.");
      })
      .finally(function () {
        if (chatTimer) clearTimeout(chatTimer);
        sendBtn.disabled = false;
        input.focus();
      });
  }
  sendForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendMessage(text);
  });
})();
