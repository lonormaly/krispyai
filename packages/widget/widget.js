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
    "--k-launcher:var(--k-primary);" +
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
    ".btn{" +
    "position:relative;width:56px;height:56px;border-radius:50%;border:0;" +
    "background:var(--k-launcher);color:var(--k-espresso);cursor:pointer;" +
    "box-shadow:0 8px 24px rgba(36,26,18,.22),0 2px 6px rgba(36,26,18,.12);" +
    "display:flex;align-items:center;justify-content:center;" +
    "margin-bottom:env(safe-area-inset-bottom,0);" +
    "transition:box-shadow 0.2s,transform 0.15s;" +
    "outline:none" +
    "}" +
    ".btn:hover{box-shadow:0 12px 32px rgba(36,26,18,.28),0 3px 8px rgba(36,26,18,.14);transform:translateY(-1px)}" +
    ".btn:active{transform:translateY(0);box-shadow:0 4px 12px rgba(36,26,18,.18)}" +
    ".btn svg{width:26px;height:26px;flex:0 0 auto}" +
    // Unread dot (jam)
    ".btn .dot{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--k-jam);border:2px solid #fff;display:none}" +
    ".btn.kunread .dot{display:block}" +
    // Online dot (pistachio) — always shows on launcher
    ".btn .online{position:absolute;bottom:1px;right:1px;width:11px;height:11px;border-radius:50%;background:var(--k-pistachio);border:2px solid #fff}" +
    // Knudge pulse animation
    "@keyframes kpulse{0%,100%{transform:scale(1)}30%{transform:scale(1.12)}60%{transform:scale(.96)}}" +
    ".btn.knudge{animation:kpulse .6s ease-in-out 2}" +
    "@media (prefers-reduced-motion:reduce){.btn.knudge{animation:none}}" +
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
    // Visitor bubble (gold, right-aligned)
    ".me{" +
    "align-self:flex-end;" +
    "background:var(--k-gold);color:var(--k-espresso);" +
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
    "border-color:var(--k-gold);" +
    "box-shadow:0 0 0 3px rgba(227,154,43,.15);" +
    "background:var(--k-card)" +
    "}" +
    // Send button — gold circle with paper-plane SVG
    ".ft button{" +
    "flex:0 0 auto;width:38px;height:38px;border:0;" +
    "background:var(--k-gold);color:var(--k-espresso);" +
    "border-radius:50%;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;" +
    "transition:background 0.15s,transform 0.1s,box-shadow 0.15s;" +
    "box-shadow:0 2px 8px rgba(227,154,43,.35)" +
    "}" +
    ".ft button:hover{background:var(--k-gold-hover);box-shadow:0 4px 12px rgba(201,132,28,.4);transform:translateY(-1px)}" +
    ".ft button:active{transform:translateY(0)}" +
    ".ft button:disabled{opacity:.45;cursor:default;transform:none;box-shadow:none}" +
    ".ft button svg{width:17px;height:17px;flex:0 0 auto}" +
    // ── Contact capture (.cap) ──
    ".cap{" +
    "padding:12px 14px;background:var(--k-card);" +
    "border-top:1px solid var(--k-border);" +
    "display:none;flex-direction:column;gap:8px;flex-shrink:0" +
    "}" +
    ".cap.show{display:flex}" +
    ".cap input{" +
    "border:1.5px solid var(--k-border);border-radius:8px;" +
    "padding:9px 12px;font-size:16px;background:var(--k-cream);color:var(--k-espresso);outline:none;" +
    "transition:border-color 0.15s" +
    "}" +
    ".cap input:focus{border-color:var(--k-gold)}" +
    ".cap input::placeholder{color:var(--k-muted-fg)}" +
    ".cap button{" +
    "border:0;background:var(--k-espresso);color:var(--k-cream);" +
    "border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;" +
    "font-weight:600;letter-spacing:0.02em;" +
    "transition:background 0.15s" +
    "}" +
    ".cap button:hover{background:#3d2e22}" +
    "</style>" +
    // ── Panel markup ──
    '<div class="panel" part="panel">' +
    // Header: avatar + title/status + mute + close
    // Avatar shows the BUTTR mark by default; applyTheme can replace src or hide
    '<div class="hd">' +
    '<img class="av" alt="Krispy">' +
    '<div class="ttl-wrap">' +
    '<span class="ttl"></span>' +
    '<span class="sub"><span class="pdot"></span>we usually reply in minutes</span>' +
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
    '<form class="cap"><input class="cn" placeholder="Your name"><input class="cc" placeholder="Email or phone"><button type="submit">Leave contact</button></form>' +
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
    // Launcher button: inline croissant SVG + unread dot + online dot
    '<button class="btn" aria-label="Open chat">' +
    // Buttr croissant mark — tasteful ~24px croissant path, gold fill + espresso outline
    '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    // Main body — crescent/croissant shape
    '<path d="M14 6C9.5 6 5.5 9 4 13.5C5.5 12 7.5 11 10 11C11.5 8.5 13.5 7 16 7C15.4 6.3 14.7 6 14 6z" fill="#e39a2b" stroke="#241a12" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M14 22C18.5 22 22.5 19 24 14.5C22.5 16 20.5 17 18 17C16.5 19.5 14.5 21 12 21C12.6 21.7 13.3 22 14 22z" fill="#e39a2b" stroke="#241a12" stroke-width="1.2" stroke-linejoin="round"/>' +
    // Center body — the bulk of the croissant
    '<ellipse cx="14" cy="14" rx="6" ry="4.5" fill="#f6d9a8" stroke="#241a12" stroke-width="1.2"/>' +
    // Score lines (the ridges)
    '<path d="M10.5 13.5C11.5 12.5 13 12 14.5 12.5" stroke="#c9841c" stroke-width="0.9" stroke-linecap="round" opacity="0.8"/>' +
    '<path d="M11 15.5C12 14.5 13.5 14 15 14.5" stroke="#c9841c" stroke-width="0.9" stroke-linecap="round" opacity="0.6"/>' +
    // Tip highlights
    '<circle cx="5.5" cy="12.5" r="2" fill="#f6d9a8" stroke="#241a12" stroke-width="1.1"/>' +
    '<circle cx="22.5" cy="15.5" r="2" fill="#f6d9a8" stroke="#241a12" stroke-width="1.1"/>' +
    "</svg>" +
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
  var capForm = $(".cap");
  var avatarEl = $(".av");
  $(".ttl").textContent = cfg.title;
  // Default avatar: BUTTR croissant mark. applyTheme can replace with a tenant URL.
  avatarEl.src = BUTTR;

  // ── theme (boot fetch, init-gated, NO poll — decorative → never blocks chat) ──
  var greeting = ""; // optional first bot bubble on open; set by theme
  var soundEnabled = true; // theme.sound (tenant); default ON. AND-gated with visitor mute below.
  function applyTheme(th) {
    if (!th) return;
    if (th.sound === false) soundEnabled = false;
    var pc = clampColor(th.primaryColor);
    if (pc) host.style.setProperty("--k-primary", pc);
    var lc = clampColor(th.launcherColor);
    if (lc) host.style.setProperty("--k-launcher", lc);
    var r = clampRadius(th.radius);
    if (r != null) host.style.setProperty("--k-radius", r + "px");
    var f = clampFont(th.font);
    if (f) host.style.setProperty("--k-font", f);
    if (th.position === "bl") {
      host.style.right = "auto";
      host.style.left = "20px";
    }
    if (typeof th.headerTitle === "string" && th.headerTitle)
      $(".ttl").textContent = th.headerTitle;
    if (typeof th.greeting === "string") greeting = th.greeting.trim();
    // avatar: literal "buttr" → inline default; an https URL → that; else keep default.
    var isHttps = typeof th.avatar === "string" && th.avatar.startsWith("https://");
    var av = th.avatar === "buttr" ? BUTTR : isHttps ? th.avatar : null;
    if (av) avatarEl.src = av;
  }
  fetch(cfg.api + "/api/widget/config?t=" + encodeURIComponent(cfg.tenant))
    .then(function (r) {
      return r.json();
    })
    .then(function (c) {
      applyTheme(c && c.theme);
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
  function notifyInbound() {
    if (panel.classList.contains("open")) return;
    playDing();
    launcher.classList.add("kunread");
    launcher.classList.remove("knudge");
    void launcher.offsetWidth; // restart the animation if it's mid-flight
    launcher.classList.add("knudge");
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

  var opened = false;
  function open() {
    hasInteracted = true; // opening counts as interaction (unlocks audio)
    panel.classList.add("open");
    launcher.classList.remove("kunread", "knudge"); // clear unread on open
    if (!opened) {
      opened = true;
      add("sys", "You're chatting with an AI assistant. A human can jump in anytime.");
      if (greeting) add("bot", greeting);
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
          showCapture();
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
  }

  // ── contact capture (on [!HANDOFF] with no form) ────────────────────────
  function showCapture() {
    capForm.classList.add("show");
  }
  capForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = capForm.querySelector(".cn").value.trim();
    var contact = capForm.querySelector(".cc").value.trim();
    if (!contact && !name) return;
    fetch(cfg.api + "/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        tenantId: cfg.tenant,
        name: name,
        contact: contact,
      }),
    }).catch(function () {});
    capForm.classList.remove("show");
    add("sys", "Thanks — we'll reach out.");
  });

  // ── data-driven lead form (on [!FORM:<id>], carried by res.form) ─────────
  // Built entirely with createElement/textContent — NEVER innerHTML for any value
  // (form fields, options, CTA labels/urls are all tenant/visitor-controlled → XSS).
  var formOpen = false;
  function showForm(form) {
    if (formOpen || !form || !form.fields) return;
    formOpen = true;
    var wrap = document.createElement("form");
    wrap.className = "cap show";

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
        }),
      }).catch(function () {});
      wrap.remove();
      formOpen = false;
      add("sys", "Thanks — we'll be in touch.");
    });

    log.parentNode.insertBefore(wrap, sendForm); // above the composer, like .cap
    log.scrollTop = log.scrollHeight;
  }

  // ── send ─────────────────────────────────────────────────────────────────
  sendForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    add("me", text);
    history.push({ role: "user", content: text });
    sendBtn.disabled = true;
    var typing = handedOff ? null : add("bot", "…");
    fetch(cfg.api + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        tenantId: cfg.tenant,
        message: text,
        history: history.slice(-10),
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
        }
        if (res.form) showForm(res.form);
        else if (res.handoff) showCapture();
      })
      .catch(function () {
        if (typing) typing.remove();
        add("sys", "Connection issue — please try again.");
      })
      .finally(function () {
        sendBtn.disabled = false;
        input.focus();
      });
  });
})();
