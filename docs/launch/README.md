# Krispy AI — Launch Playbook

**Status:** Ready to execute. This is the master plan for launching Krispy AI — the
open-source AI live chat with human-in-the-loop Telegram handoff. One solo founder can
run this whole thing from these files.

**Read first:** [`product-marketing.md`](../marketing/product-marketing.md) (what we say),
[`brand-voice.md`](../brand/brand-voice.md) (how we say it), [`brand-soul.md`](../brand/brand-soul.md)
(who we are). This playbook consumes all three — it doesn't restate them.

**The files in this folder** (each is copy-ready, edit the `[bracketed]` bits before you ship):

| File | What it is |
|---|---|
| `README.md` (this) | The master plan: positioning, goal, timeline, channels, assets, retention loop, SEO engine |
| [`show-hn.md`](./show-hn.md) | Show HN title, body, and prepped answers to the hard questions |
| [`product-hunt.md`](./product-hunt.md) | PH tagline, description, maker's first comment, gallery, launch-day plan |
| [`x-thread.md`](./x-thread.md) | Full launch thread in the founder's voice |
| [`linkedin.md`](./linkedin.md) | Build-in-public launch post (EN + short HE) |
| [`reddit.md`](./reddit.md) | r/selfhosted + r/opensource posts (substance-first) |
| [`copy-bank.md`](./copy-bank.md) | Reusable one-liners, taglines, elevator pitch, boilerplate |

> 🥐 *Buttr's note: "big launch. i'll be answering visitors the whole time so you can go
> touch grass. or watch the star counter. your call."*

---

## 1. Positioning recap (the one thing to never lose)

> **The AI answers. You tag in.**
> Open-source live chat with a human in the loop. An AI answers your visitors in your
> voice and hands off to *you* on Telegram the second a person is needed. Free to
> self-host, forever. The open alternative to Intercom and Crisp.

- **Category:** open-source AI live chat *with human handoff*.
- **The villain:** per-seat SaaS pricing, vendor lock-in, and your conversations living on
  someone else's servers — plus the dumb bot that deflects instead of connecting. Name it
  honestly; never trash competitors. *"Intercom's great at being Intercom. It's just not
  built for one person who wants to own their stack."*
- **Audience:** indie hackers, solo founders, small teams. Allergic to $X/seat.
- **The honest cost line (memorize it):** paid stack ~$100–400+/mo → **$0 to self-host.**

---

## 2. The goal — what "won" looks like

Two numbers matter. Everything below serves them.

1. **GitHub stars** — the open-source proof-of-life metric. Stars = credibility = the top
   of every future funnel.
2. **Krispy Cloud trial signups** — the $19/mo flat, 14-day-trial hosted tier. This is the
   revenue path. Self-host is the top of funnel; Cloud is the business.

**Independent targets** (my estimate, not anchored to any goal you've set — confidence
`moderate`; open-source launches vary wildly with reach):

| Metric | Launch week (stretch) | Launch week (base) | Day 90 |
|---|---|---|---|
| GitHub stars | 1,000+ | 300–500 | 2,000–3,000 |
| Cloud trials | 40–60 | 15–25 | 150–250 |
| Discord members | 150 | 50 | 500 |
| Newsletter subs | 200 | 75 | 800 |

Reality check: a *front-page* Show HN or a top-5 Product Hunt day is what pushes you to the
stretch column. Neither is guaranteed. Base column assumes decent-but-not-viral. Plan for
base, be ready to ride stretch. **The star count is a vanity metric until it converts to
Discord members and trials — the whole launch is designed to move borrowed attention into
owned channels before it evaporates.**

**One north-star behaviour to instrument:** did they *see the handoff work*? A visitor
sends a message → the founder's Telegram pings → the reply lands live in the chat. That
"oh, it actually got me" moment is the product. Track demo-GIF views and live-demo hits.

---

## 3. Channel strategy — own the audience, borrow the reach

The ORB model (Owned / Rented / Borrowed). The whole launch is a machine for turning
**borrowed** spikes into **owned** relationships.

### Own it (compounds, never evaporates) — build BEFORE launch day
- **GitHub repo** — the product *and* the landing page for devs. README is the hero. Pinned
  issues, a clean CONTRIBUTING, a `good first issue` label, a visible roadmap.
- **Docs site** (`krispyai.com/docs`) — never gated. Self-host in one command up top. This is
  also your AI-SEO surface (see §7).
- **Discord** — set it up, seed it, have the invite live *before* you post anywhere. Every
  spike funnels here.
- **Newsletter** — one field, "get the changelog + the occasional build-in-public note." The
  only owned channel that survives a dead algorithm.

### Rent it (platform-dependent spikes) — launch day + ongoing
- **Show HN** — the single highest-leverage move for this audience (see [`show-hn.md`](./show-hn.md)).
- **Product Hunt** — the design-and-maker-community spike (see [`product-hunt.md`](./product-hunt.md)).
- **X/Twitter** — the launch thread + ongoing build-in-public (see [`x-thread.md`](./x-thread.md)).
- **LinkedIn** — the founder-story post; underrated for reach, low competition for dev tools
  (see [`linkedin.md`](./linkedin.md)).
- **Reddit** — r/selfhosted and r/opensource; substance-only, marketing gets you banned (see
  [`reddit.md`](./reddit.md)).

### Borrow it (other people's audiences) — the multiplier
- **Co-launch with an adjacent OSS tool.** Ideal partners: a self-hosted analytics tool
  (Plausible/Umami-adjacent), a self-hosted forms/feedback tool, a Cloudflare-Workers
  starter-kit maintainer, a Telegram-bot-framework author. The pitch: *"our audiences
  overlap perfectly — indie devs who self-host. Cross-post launch day, we both win."*
- **Newsletters** that cover open source / self-hosting / indie hacking: pitch a short
  "here's what I built and why" — the founder story, not a press release. (e.g. the
  self-hosting and indie-hacker newsletters; find 3–5, DM the writers a month out.)
- **Podcasts / streams** in the build-in-public and self-hosted space — offer to demo the
  handoff live. A live demo of the Telegram ping is a 5-second sell.
- **The "steal it, drop a ⭐" energy** — explicitly invite people to fork it, deploy it, rip
  the handoff pattern into their own thing. Generosity is the growth loop for OSS.

**Rule:** every borrowed/rented post has ONE job — send people to something you own (repo,
Discord, newsletter). A viral tweet that converts to zero followed accounts is a fireworks
show you paid for.

---

## 4. The timeline

### Pre-launch (weeks −4 to −1) — build the owned base, line up the borrowed reach

**Week −4 — foundation**
- [ ] README is *the* landing page: hero line, demo GIF at the top, one-command self-host,
      the comparison table, the honest cost line. (Pull copy from [`copy-bank.md`](./copy-bank.md).)
- [ ] `krispyai.com` live: hero, the handoff demo, `docs/`, `/llms.txt`, `/pricing.md`.
- [ ] Discord created + seeded with channels (see §6). Invite link live and permanent.
- [ ] Newsletter signup live (one field).
- [ ] Instrument analytics: repo referrers, demo-GIF views, trial-signup source, Discord joins.

**Week −3 — assets** (see §5 checklist)
- [ ] The **handoff demo GIF** — the single most important asset. Visitor types → Telegram
      pings → reply lands live. 8–15s, loops, readable on mobile.
- [ ] Screenshots: widget, Telegram handoff, admin/knowledge-base, one-command deploy.
- [ ] OG image (repo + site + social). Comparison table graphic.

**Week −2 — seed the owned audience + recruit founding members**
- [ ] Soft-share to 20–50 people by hand (DMs, not broadcast): *"building this, would love
      your eyes before I launch — mind kicking the tires?"* These become founding members.
- [ ] Get 5–10 real self-host deploys. Fix what breaks. Collect the first quotes/logos.
- [ ] Line up the co-launch partner(s) and confirm the date. Brief them.
- [ ] Draft every post in this folder; fill the `[brackets]`. Get a friend to read the Show HN.

**Week −1 — dry run**
- [ ] Full self-host runbook test on a clean account — *time it*, screenshot every step, fix
      the friction. If "one command" is actually five, say so honestly or make it one.
- [ ] Pre-write the FAQ answers (Show HN hard questions — [`show-hn.md`](./show-hn.md) §3).
- [ ] Schedule: pick launch day (Tue/Wed/Thu — see below). Set PH for 12:01am PT.
- [ ] Warn the founding members: *"launching Tuesday. If you like it, a ⭐ and a comment that
      morning is the whole ballgame. No pressure, no scripts."*

### Launch day — be present, all day

**Timing:** Product Hunt launches at **00:01 PT**. Post **Show HN mid-morning US Eastern**
(≈8–10am ET) on a **Tue/Wed/Thu** — best HN traffic, avoids weekend and Monday noise. Stagger
so you're not splitting your own attention across two firehoses at once; PH runs all day on
its own clock, HN needs your first 2 hours.

Run of show:
1. **00:01 PT** — Product Hunt goes live. Post the maker's first comment immediately.
2. **~08:30 ET** — Show HN posted. **Now clear your calendar for 3 hours.** First 60–90 min of
   comment velocity decides front page.
3. **Morning** — X thread live. LinkedIn post live (with repo link in *first comment*, not the
   body — LinkedIn throttles posts with outbound links).
4. **Reddit** — r/selfhosted first (most receptive). Watch the room; if it lands, r/opensource
   next day, not same day (don't carpet-bomb).
5. **All day** — answer *every* comment, everywhere, fast and human. This is the actual job.
   Thank people. Fix reported bugs live and reply "fixed in `<commit>`" — nothing converts a
   skeptic like a same-day fix.
6. **Convert the spike** — every thread ends pointing at Discord or the newsletter. Pin the
   Discord invite in your PH comment and HN doesn't allow it — put it in the repo README they'll
   click through to.
7. **Buttr works the room** — the Discord welcome, the empty states, the error messages carry
   the croissant. The *answers to hard questions* stay clean and honest.

### Post-launch (weeks +1 to +8) — don't let it die

- **Week +1:** Write the "we launched, here's what happened" retro (build-in-public gold —
  numbers, what broke, what you learned). Post the stars-over-time chart. Ship a visible fix
  from launch feedback and changelog it.
- **Weeks +2–4:** Publish the **comparison pages** — `vs Intercom`, `vs Crisp`, `vs Chatwoot`
  (§7). This is the compounding engine; it pays off for months.
- **Ongoing cadence:** ship-in-public weekly (see §6). One marquee feature ~6–8 weeks out =
  **launch #2**. Launches are recurring; plan the next while this one's warm.
- **Onboarding sequence** for trial signups: welcome → "did the handoff work? here's the
  30-second demo" → mid-trial check-in → day-12 "your trial ends in 2 days, here's what
  self-host vs Cloud gets you." Warm, founder-signed, never "your trial is expiring!!!".

---

## 5. Asset checklist (build in week −3, reuse everywhere)

The **handoff demo GIF** is non-negotiable and does more selling than any sentence.

- [ ] **Handoff demo GIF** — visitor types a question → AI answers → asks the hard one →
      *your Telegram pings* → you reply from your phone → it lands live in the widget. 8–15s,
      loops clean, legible at mobile width. This goes: top of README, PH gallery, X thread,
      landing hero.
- [ ] **Screenshots** (PNG, clean, consistent frame): the widget on a real page; the Telegram
      handoff message; the knowledge-base/voice editor; the one-command deploy in a terminal.
- [ ] **OG image** — 1200×630, wordmark + croissant + "The AI answers. You tag in." Used by
      repo social preview, site, every link unfurl.
- [ ] **Comparison table graphic** — the Krispy/Intercom/Chatwoot table from
      product-marketing §9, as an image for social + PH gallery.
- [ ] **PH gallery** (see [`product-hunt.md`](./product-hunt.md)): GIF first, then 4–5 shots.
- [ ] **60–90s demo video** (optional but strong) — screen-record the whole flow with a
      voiceover. Doubles as the landing hero and a YouTube asset for AI-SEO how-to queries.
- [ ] **Repo hygiene** — README hero, badges (license/stars/Discord), CONTRIBUTING, LICENSE
      (MIT), `good first issue` label, pinned roadmap issue, a `SECURITY.md`.
- [ ] **Buttr sticker/avatar** — the croissant as Discord emoji + PH/X avatar. Cheap, sticky.

---

## 6. The "make them obsessed" retention loop

Stars are attention. **Retention is a community that ships together.** Members join for the
product; they stay for the people and the identity ("I self-host my own support, and there's a
croissant"). The flywheel: discover → deploy → belong → contribute → bring a friend.

### Discord architecture (keep it small and alive, not big and dead)
- `#welcome` — Buttr greets, one-line "what brings you here," pin the self-host quickstart.
- `#show-your-deploy` — members post their site with Krispy live. Social proof + identity.
- `#help` / `#self-hosting` — you answer fast early; power users answer later (that's the goal).
- `#feature-requests` — public, upvoted. People stay when they see their idea shipped.
- `#changelog` — every ship, automated from GitHub releases. Momentum you can *see*.
- `#buttr` — off-topic, croissant memes, the fun. Every good community has a couch.

### Rituals (habit = retention)
- **Weekly ship note** — "this week in Krispy" every Friday, in Discord + newsletter. Even a
  small week. Consistency > size.
- **Monthly community call / office hours** — 30 min, demo the new thing, answer live. Record it.
- **Founding-member badge** — the first ~50 self-hosters get a role + a shout-out in the README
  contributors/thanks section. Status is free and it's the strongest retention lever OSS has.
- **"Show your deploy" spotlight** — feature one member's setup weekly on X/Discord. People bring
  their friends when *they* get the spotlight.

### Build-in-public cadence (this IS the marketing, ongoing)
- Ship visibly. Changelog everything. Screenshot the star chart at milestones (100, 500, 1k).
- Post the messy middle — "spent 4 hours on a Telegram webhook race condition, here's the fix."
  Honesty and process are the content; the founder's own LinkedIn/X voice is the model:
  build-in-public, community, *"steal it, drop a ⭐."*
- Celebrate contributors by name. A merged PR gets a thank-you post. That's how you get PR #2.

### Founding-member recruitment (start week −2, never stops)
1. Hand-pick 20–50 from your network + the target subreddits/Discords + replies to your
   build-in-public posts. DM, don't broadcast.
2. Give them something real: early access, a direct line to you, the founding-member badge,
   their logo/name in the README.
3. Ask for exactly one thing at launch: *"a ⭐ and an honest comment launch morning."* Not a
   script, not a favor-farm. Honest fans, honestly asked.

---

## 7. Comparison-page SEO — the compounding engine

The launch spike fades in a week. **Comparison pages compound for months.** ~33% of AI-search
citations come from comparison content, and "X vs Y" is exactly what someone types right before
they switch tools. This is the highest-ROI content you'll write all year.

**Ship these three pages** (weeks +2–4), each answer-first and scrupulously fair:
- `krispyai.com/vs/intercom`
- `krispyai.com/vs/crisp`
- `krispyai.com/vs/chatwoot`

**Structure each page for extraction (AI-SEO rules):**
- **Answer-first.** Open with a 40–60 word direct answer: *"Krispy is the open-source, self-
  hostable alternative to Intercom, with AI answers and human handoff to Telegram built in and
  free. Intercom is a mature hosted platform with deeper enterprise features and per-seat
  pricing. Choose Krispy to own your data and avoid the per-seat tax; choose Intercom if you
  need [X]."*
- **The comparison table** (from product-marketing §9) near the top.
- **Be fair.** State honestly what the competitor does better. Fairness is what makes the page
  *citable* — a hit piece gets ignored by LLMs and readers. Win on facts: cost, openness,
  lock-in, data ownership.
- **The honest cost math**, with the number: *"~$X/seat/mo vs $0 self-host / $19 flat hosted."*
- **Schema:** FAQ + SoftwareApplication markup. `/llms.txt` and `/pricing.md` at site root.
  Don't block GPTBot/PerplexityBot/ClaudeBot in robots.txt. Never gate docs.
- **"Last updated: [date]"** visible. Freshness is a ranking signal for AI answers.

**Compounding follow-ons:** `how to self-host live chat`, `free Intercom alternative`,
`Telegram customer support`, `open-source Crisp alternative` — each a factual, answer-first
doc. Monthly, test your top 20 queries in ChatGPT/Perplexity/Google AI Overviews; are you cited?

---

## 8. The three highest-leverage moves (if you do nothing else)

1. **The handoff demo GIF at the top of everything.** The product's whole magic is the
   Telegram ping. One loop shows it faster than any paragraph sells it. Build it first; it's in
   the README, the Show HN, the PH gallery, and the X thread.
2. **A great Show HN + you present all day.** For this exact audience (indie devs who hate
   per-seat SaaS), a front-page Show HN is worth more than PH and every social post combined.
   The title and body are honest, the story is real, and you answer every hard question fast.
3. **Ship the three comparison pages in weeks +2–4.** The launch is a spike; the `vs Intercom /
   Crisp / Chatwoot` pages are the annuity. They catch the person mid-switch, for months, and
   they're what LLMs cite. This is the difference between a launch and a business.

---

> 🥐 *"launch's over? nah. i'm just getting warmed up. go ship the comparison pages, i'll keep
> the visitors company. à bientôt."* — Buttr
