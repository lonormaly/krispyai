# Show HN — Krispy AI

The single highest-leverage move for this audience: indie devs who resent per-seat SaaS live
on Hacker News. A front-page Show HN out-converts everything else combined. The whole game is
an **honest title, a real story, and you answering every hard question fast.**

**When to post:** Tue/Wed/Thu, ~8–10am US Eastern. Clear the next 3 hours — comment velocity in
the first 60–90 min decides the front page. HN allows no images in the post; the demo GIF lives
in the repo README they'll click through to.

**Rules for HN specifically:** no marketing voice, no exclamation marks, no Buttr in the post
body (save the croissant for the repo — HN reads playful-in-the-pitch as spam). Lead with what
it is and the honest story. Be the most helpful person in your own thread.

---

## Title (plain, honest — pick one)

**Primary:**
> Show HN: Krispy – Open-source AI live chat that hands off to you on Telegram

Alternates:
- Show HN: Krispy – Open-source live chat with AI, hands off to a human on Telegram
- Show HN: I built the open-source Intercom alternative because I'm one person
- Show HN: Krispy – Self-hostable AI live chat with human handoff (MIT)

Keep "Show HN:", say "open source," name the mechanic (Telegram handoff). Don't oversell in the
title — HN punishes hype and rewards the plain description.

---

## Body

> I kept hitting the same wall on my own projects: I want to talk to visitors on my landing
> page, but every option is a bad trade. Either a dumb bot that answers nothing real, or a
> $100–400/mo SaaS to get an actual human in the loop — with per-seat pricing, a login my
> visitor never asked for, and all our conversations on someone else's servers. I'm one person.
> Intercom quoted me per seat. That math never works for a solo founder.
>
> So I built Krispy. It's open-source (MIT) live chat with a human in the loop:
>
> - An AI answers your visitors in *your* voice, from a knowledge base you edit — not a generic
>   "How can I help you today?" bot.
> - The moment a real person is needed, it hands off to **you on Telegram**. You reply from the
>   chat app you already have open, and your message lands back in the visitor's widget, live.
>   Your phone is the dashboard. No new inbox to babysit.
> - It's free to self-host — one deploy on Cloudflare's free tier, using Workers AI, so there's
>   no API key to manage and no per-seat tax. Your data stays in your own Cloudflare account.
>
> The design bet is that the AI should be the *first* touch, never the last word. Most "AI
> support" is sold on deflection — talk to customers *less*. I wanted the opposite: answer the
> easy stuff automatically so I can actually show up for the conversations that matter.
>
> There's a hosted version (Krispy Cloud, $19/mo flat, 14-day trial) for people who don't want
> to deploy anything — but self-host is first-class and always free. The hosted tier is a
> convenience, not the only door in.
>
> Repo (README has a GIF of the handoff): https://github.com/lonormaly/krispyai
> Site/docs: https://krispyai.com
>
> It's early. I'd genuinely like to hear where it breaks, what's missing, and whether the
> handoff-to-Telegram model makes sense to you or if I'm solving my own problem. Happy to answer
> anything about the architecture, the Cloudflare/Workers AI setup, or the business model.

*(Swap "Intercom quoted me per seat" for your real number/story if you have one — the more
specific and true, the better it lands. If you don't have a real quote, cut that sentence
rather than invent one; HN sniffs out fabricated pain.)*

---

## Prepared answers to the hard HN questions

HN will stress-test this. Answer plainly, concede real limitations, never get defensive. Every
honest "here's the tradeoff" answer builds more trust than a dodge.

### "Why not just use Chatwoot? It's open source and mature."
> Fair — Chatwoot is great and more mature. The difference is the shape. Chatwoot is a full
> self-hosted *agent inbox* — you run a server, your team logs into a dashboard, and the AI is
> mostly bring-your-own. Krispy is narrower on purpose: the AI answering in your voice is built
> in and free (Cloudflare Workers AI, no key), the human handoff is to **Telegram** so there's
> no dashboard to sit in, and it deploys on Cloudflare's free tier with no server to run. If you
> want a full support-desk for a team, Chatwoot is probably the better fit. If you're one person
> or a tiny team who wants AI + handoff-to-your-phone with near-zero ops, that's the gap Krispy
> fills. Different tool for a different person.

### "Is it secure? You're putting AI in front of my customers and my data in Telegram."
> Two honest parts. (1) Self-hosted, your data lives in *your* Cloudflare account and *your*
> Telegram — Krispy isn't a middleman sitting on your conversations. (2) That said, treat the AI
> like any LLM in front of users: it answers from the knowledge base you give it, and you should
> assume prompt-injection is possible, which is exactly why the human handoff exists — anything
> sensitive escalates to you. There's a `SECURITY.md` in the repo and I'll take reports
> seriously. It's early; audit the code before you put it on a high-stakes site. I'd rather you
> read it than trust me.

### "What's the self-host reality — is 'one command' actually one command?"
> Honest answer: it's a Cloudflare Workers deploy — clone, set a couple of env vars (your
> Telegram bot token, your knowledge base), and deploy. On a clean account it took me about
> [X] minutes. It's not literally one keystroke, and I won't pretend it is; the docs walk every
> step with screenshots. Workers AI means no separate LLM API key. If any step trips you up,
> that's a docs bug — tell me and I'll fix it same day.

### "What's the business model? What stops this from being abandonware or a rug-pull?"
> Open-core, stated plainly. The whole product is MIT and self-hostable for free, forever —
> that's not the loss-leader, that's the point. The business is **Krispy Cloud**: $19/mo flat
> (not per seat) for people who'd rather not deploy or manage infra. Same product, I run it for
> you. I make money when convenience is worth $19 to someone, not by holding features hostage —
> there's no "export is a paid feature," no proprietary data format. If I ever disappeared, the
> code is yours and it runs on your own Cloudflare account with no dependency on me. That's the
> anti-rug-pull design, on purpose.

### "Why Telegram and not Slack/email/WhatsApp?"
> Telegram first because it's the fastest to wire up (clean bot API, no business-verification
> gauntlet) and it's where a lot of indie founders already are on their phone. Slack is next on
> the roadmap. The handoff channel is meant to be pluggable — Telegram's just the one that let me
> ship the core idea fastest. Which would you want next?

### "Cloudflare Workers AI models aren't as good as GPT-4/Claude."
> True, and that's a deliberate tradeoff for the free-to-self-host promise — zero-key, zero-cost
> AI beats a marginally smarter answer for the FAQ-and-triage job, and the *whole design* is that
> the model hands off to a human the moment it's out of its depth. If you want a stronger model,
> it's swappable — bring your own key. The floor being free is the feature.

### "How is this different from the crisp-cf-ai-chat starter / isn't this just glue?"
> It started from that pattern and I'm not going to pretend it's a research breakthrough — a lot
> of the value *is* the glue done well: the in-your-voice knowledge base, the live round-trip from
> Telegram back into the widget, the one-deploy setup, the hosted option. "Boring glue that
> actually works and you can self-host for free" is the pitch. If that's not novel enough to be
> interesting, that's fair — but it solved my problem and it's free to try.

### "Does the visitor know they're talking to a bot?"
> Yes, by design. We don't pretend the bot is a person — that's a line we won't cross. The value
> isn't fooling anyone; it's that the easy questions get answered instantly and the real ones get
> a real human, fast.

---

## Launch-day HN conduct

- Answer within minutes for the first 2 hours. Upvotes follow engaged threads.
- Concede every fair criticism out loud. "You're right, that's a limitation — here's the
  tradeoff" is your strongest move.
- Fix a reported bug live and reply "fixed in `<commit>`." Nothing converts a skeptic faster.
- No arguing, no defensiveness, no marketing-speak, ever. You're the most helpful person here.
- Don't ask for stars on HN (frowned upon). The repo click-through earns them.
