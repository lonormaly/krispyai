# Reddit — r/selfhosted + r/opensource

These communities *hate* marketing and will bury (or ban) anything that smells like a pitch.
**Lead with substance and the self-host story. No Buttr, no taglines, no croissant, no "check out
my product."** You're a builder sharing a thing you made and self-host. That's it.

**Ground rules:**
- Read each sub's self-promotion rules first. Many require a flair, a ratio of participation to
  promotion, or a specific day. Follow them exactly.
- Be a real member first: comment on other posts for a week or two before you post yours.
- Post to **r/selfhosted first** (most receptive to "free to self-host"). If it lands, do
  **r/opensource the next day**, not the same day — don't carpet-bomb.
- Disclose you're the author, plainly. Hiding it is what gets you crucified.
- Answer every technical question in detail. This crowd rewards depth and punishes hand-waving.
- No link in the title. Put the repo link in the body, once, near the bottom.

---

## r/selfhosted

**Title:**
> I built an open-source, self-hostable live chat with AI + human handoff to Telegram (runs free on Cloudflare)

**Body:**
> I self-host most of my stack and the one gap I kept hitting was live chat. The hosted options
> (Intercom, Crisp, Drift) are $100–400/mo, per seat, and they sit on all your conversation data.
> Chatwoot is the usual self-hosted answer but it's a whole server + agent-inbox to run, which
> felt heavy for what I wanted. So I built something narrower and I'm sharing it in case it's
> useful to anyone here.
>
> It's called Krispy. What it does:
>
> - An AI answers visitors on your site, from a knowledge base you write (answers in your voice,
>   not a generic bot).
> - When a real person is needed, it hands off to **you on Telegram** — you reply from the app,
>   and it lands back in the visitor's chat live. No dashboard to sit in.
> - **Self-hosted, it runs on Cloudflare's free tier** — Workers + Workers AI (so no separate LLM
>   API key) + a Telegram bot token. Your data stays in your own Cloudflare account. No middleman.
>
> **The self-host reality**, honestly: it's a Workers deploy — clone, set a couple of env vars
> (Telegram bot token + your knowledge base), deploy. Took me ~[X] min on a clean account. Docs
> walk every step. No server to maintain, no DB to babysit (it uses [Cloudflare KV/D1 — fill in]).
>
> It's MIT licensed. Full disclosure, I'm the author. There's a hosted version if you don't want
> to deploy anything, but self-host is free forever and first-class — I'm not going to paywall the
> thing I'm posting in r/selfhosted.
>
> Repo: https://github.com/lonormaly/krispyai
>
> Genuinely want the feedback: does the Telegram-handoff model make sense to you, what would you
> want self-hosted differently, and what channel after Telegram (Slack? Matrix? ntfy?). Happy to
> go deep on the architecture in the comments.

---

## r/opensource

**Title:**
> Krispy — MIT-licensed AI live chat with human handoff, an open alternative to Intercom/Crisp

**Body:**
> Sharing an open-source project I built and maintain. Krispy is live chat with a human in the
> loop: an AI answers visitors in your voice, and hands off to a human on Telegram when a real
> person is needed. It's meant as the open, self-hostable alternative to closed widgets like
> Intercom and Crisp.
>
> Why open source specifically: a chat widget sees every conversation you have with your users.
> That's exactly the kind of thing I don't want to be closed and phoning home. So the whole
> product is MIT — you can read every line, fork it, and self-host it on Cloudflare's free tier
> with no per-seat pricing and no vendor holding your data.
>
> **Open-core, stated plainly:** the full product is MIT and free to self-host forever. There's a
> hosted tier ($19/mo flat) for convenience, but nothing is held hostage — no proprietary data
> format, no "export is a paid feature." Easy in, easy out.
>
> Stack: Cloudflare Workers + Workers AI + a Telegram bot. Contributions welcome — there are
> `good first issue`s tagged and a roadmap in the repo.
>
> Repo: https://github.com/lonormaly/krispyai
>
> I'm the author and happy to answer anything about the architecture, the license choice, or the
> business model. Feedback and PRs both welcome.

---

## Notes
- Fill `[X]` deploy time and the actual storage backend (KV/D1) before posting — this crowd will
  ask and vagueness reads as a marketer who didn't build it.
- If someone compares it to Chatwoot (they will), answer with the honest "narrower, no server,
  Telegram handoff, AI built-in" framing from [`show-hn.md`](./show-hn.md) §3. Never trash Chatwoot.
- Don't ask for stars on Reddit. Ask for feedback. Stars follow the repo click if the thing's good.
- If a post gets removed for self-promo, don't argue with mods — message them politely, ask how
  to share it correctly, and follow their rule. A ban here costs you the channel for good.
