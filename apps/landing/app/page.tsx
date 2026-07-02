import Link from "next/link";
import { Button, Card, Section, ButtrSays, AwningStripe, Stamp, Receipt } from "@krispy/ui";
import { pageMetadata, faqJsonLd, JsonLd } from "@krispy/seo";
import { LiveDemo } from "./live-demo";
import { Reveal } from "./reveal";

export const metadata = pageMetadata({
  description:
    "Open-source AI live chat with a human in the loop. The AI answers in your voice and hands off to you on Telegram the second a human's needed. Free to self-host — the open alternative to Intercom & Crisp.",
  tagline: "the ai answers · you tag in",
  path: "/",
});

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/lonormaly/krispyai";
const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL ?? "#cloud";
const BLOG_URL = process.env.NEXT_PUBLIC_BLOG_URL ?? "http://blog.krispy.localhost:1355";

// Live GitHub stars — real, from shields.io. Baked-gold on espresso to match the palette.
const STARS_BADGE =
  "https://img.shields.io/github/stars/lonormaly/krispyai?style=for-the-badge&logo=github&label=stars&color=E39A2B&labelColor=241A12";

// Shared focus ring for raw anchors (Button already ships its own focus-visible).
const FOCUS =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-espresso";

type Step = { img: string; n: string; title: string; body: string };
const STEPS: Step[] = [
  {
    img: "/brand/buttr-cooking.webp",
    n: "01",
    title: "the bot cooks",
    body: "Krispy answers your visitors instantly — in your voice, from a knowledge base you write. Not a generic 'how can I help you today' bot.",
  },
  {
    img: "/brand/buttr-chill.webp",
    n: "02",
    title: "it knows when to tap out",
    body: "Refund edge case? Hot lead? A visitor who just wants a person? Krispy tags you in instead of flailing.",
  },
  {
    img: "/brand/buttr-sparkle.webp",
    n: "03",
    title: "you tag in — from your phone",
    body: "The handoff pings your Telegram. You reply from wherever you are, and it lands live in the visitor's chat. No new dashboard.",
  },
];

type Cell = boolean | string;
type CompareRow = { label: string; krispy: Cell; intercom: Cell; chatwoot: Cell };
const COMPARE: CompareRow[] = [
  { label: "Open source (MIT)", krispy: true, intercom: false, chatwoot: "so-so" },
  { label: "Free to self-host", krispy: true, intercom: false, chatwoot: false },
  { label: "AI answers, built in", krispy: true, intercom: "paid add-on", chatwoot: "BYO" },
  {
    label: "Human handoff to your phone",
    krispy: true,
    intercom: "their app, paid",
    chatwoot: "so-so",
  },
  { label: "No per-seat tax", krispy: true, intercom: false, chatwoot: true },
  { label: "Own your data", krispy: true, intercom: false, chatwoot: true },
];

type Who = { n: string; t: string; b: string };
const WHO: Who[] = [
  {
    n: "01",
    t: "indie hackers & solo founders",
    b: "One person, one product, no support team and no support budget. You want a human touch without hiring for it.",
  },
  {
    n: "02",
    t: "creators & small teams",
    b: "Coaches, studios, agencies, small e-commerce — you close by conversation and want leads on your phone, not buried in a dashboard.",
  },
  {
    n: "03",
    t: "devs shipping for clients",
    b: "Drop in an open widget you actually control, on infrastructure you own — not another reseller seat to explain on the invoice.",
  },
];

type Feature = { n: string; t: string; b: string };
const FEATURES: Feature[] = [
  {
    n: "01",
    t: "human-in-the-loop",
    b: "The bot's the first touch, never the last word. Reply from Telegram; it shows up live in the chat.",
  },
  {
    n: "02",
    t: "open source, MIT",
    b: "Read every line, fork it, own it. The free alternative to Intercom & Crisp — forever.",
  },
  {
    n: "03",
    t: "free to self-host",
    b: "One command on Cloudflare's free tier. No API key, no server to babysit, no surprise invoice.",
  },
  {
    n: "04",
    t: "answers in your voice",
    b: "One file is the bot's brain. It speaks as you, and won't make things up.",
  },
];

type Faq = { q: string; a: string };
const FAQ: Faq[] = [
  {
    q: "Is it really free?",
    a: "Yes. Krispy is MIT-licensed and self-hosts on Cloudflare's free tier with no API key — $0 to run, forever. Krispy Cloud ($19/mo) is an optional convenience if you'd rather not touch a terminal.",
  },
  {
    q: "Self-host or Krispy Cloud — which do I pick?",
    a: "Self-host if you want to own the code and data and don't mind one deploy command. Pick Krispy Cloud if you'd rather we host, scale, and auto-update it for you. It's the same product; Cloud just runs the infra.",
  },
  {
    q: "Where does my data live?",
    a: "On self-host, every conversation stays in your own Cloudflare account and your Telegram — it never passes through us. No proprietary format, no 'export is a paid feature.' Leaving is as easy as arriving.",
  },
  {
    q: "Does the AI make things up?",
    a: "Krispy answers from a knowledge base you write, in your voice — not open-ended guessing. When it isn't sure, or a visitor asks for a person, it tags you in on Telegram instead of inventing an answer.",
  },
  {
    q: "How does the Telegram handoff work?",
    a: "Connect a Telegram bot once. When a visitor needs a human, Krispy pings you there; you reply from your phone and it lands live in the visitor's chat. No new dashboard, no app to babysit.",
  },
];

type Post = { slug: string; title: string; blurb: string };
const POSTS: Post[] = [
  {
    slug: "krispy-vs-intercom",
    title: "Krispy vs Intercom",
    blurb: "The self-hosted, open alternative — and the honest cost math.",
  },
  {
    slug: "self-host-live-chat-cloudflare",
    title: "Self-host on Cloudflare, free",
    blurb: "Live chat on the free tier, no key, in one command.",
  },
  {
    slug: "how-we-built-live-takeover-durable-objects",
    title: "How live takeover works",
    blurb: "The Durable-Object trick behind bot→human, live.",
  },
  {
    slug: "why-open-source",
    title: "Why we made Krispy open source",
    blurb: "Trust by inspection, not by a badge.",
  },
];

function Cell({ v }: { v: Cell }) {
  if (v === true) return <span className="text-lg font-black text-fresh">✓</span>;
  if (v === false) return <span className="text-espresso/25">—</span>;
  return <span className="font-mono text-[11px] text-muted-foreground">{v}</span>;
}

export default function Landing() {
  return (
    <div className="overflow-x-clip">
      <JsonLd data={faqJsonLd(FAQ.map((f) => ({ question: f.q, answer: f.a })))} />

      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b-2 border-espresso bg-cream/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className={`flex items-center gap-2 ${FOCUS}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/buttr-beret.webp"
              alt="Buttr, the Krispy croissant mascot"
              width={36}
              height={36}
              className="size-9 object-contain"
            />
            <span className="font-display text-2xl font-black tracking-tight">krispy</span>
          </Link>
          <nav className="hidden items-center gap-7 font-mono text-[13px] font-medium text-muted-foreground md:flex">
            <a href="#how" className={`transition-colors hover:text-jam ${FOCUS}`}>
              how it works
            </a>
            <a href="#compare" className={`transition-colors hover:text-jam ${FOCUS}`}>
              vs intercom
            </a>
            <a href="#faq" className={`transition-colors hover:text-jam ${FOCUS}`}>
              faq
            </a>
            <a href={BLOG_URL} className={`transition-colors hover:text-jam ${FOCUS}`}>
              blog
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden font-mono text-espresso hover:bg-acid hover:text-espresso sm:inline-flex"
            >
              <a href={GITHUB_URL}>★ Star</a>
            </Button>
            <Button
              asChild
              variant="bold"
              size="sm"
              className="shadow-[3px_3px_0_0_var(--espresso)] hover:shadow-[1px_1px_0_0_var(--espresso)]"
            >
              <a href={CLOUD_URL}>Try Krispy Cloud</a>
            </Button>
          </div>
        </div>
      </header>

      <AwningStripe />

      {/* ── Hero ────────────────────────────────────────────── */}
      <Section tone="cream" bare className="relative">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
          <div className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-espresso bg-acid px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-espresso shadow-[3px_3px_0_0_var(--espresso)]">
              let the bot cook · chaud devant 🥐
            </span>
            <h1 className="font-display font-black leading-[0.82] tracking-[-0.03em] text-balance text-[clamp(3.5rem,11vw,8rem)]">
              the ai
              <br />
              answers.
              <br />
              <span className="text-jam">you tag in.</span>
            </h1>
            <p className="max-w-md text-lg font-medium text-muted-foreground">
              Krispy answers your visitors in your voice — and taps you in on Telegram the second a
              human&apos;s needed. Open source. Self-host in one command. No per-seat tax.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="bold" size="lg" className="text-base">
                <a href={GITHUB_URL}>Self-host free →</a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-2 border-espresso bg-transparent font-mono text-base font-semibold text-espresso hover:bg-acid hover:text-espresso"
              >
                <a href="#demo">See the handoff</a>
              </Button>
            </div>
            <p className="font-mono text-xs font-medium text-muted-foreground">
              MIT · runs on Cloudflare&apos;s free tier · no credit card
            </p>
          </div>

          <div id="demo" className="relative flex justify-center md:justify-end">
            <Stamp className="absolute -left-4 -top-8 z-20 hidden bg-cream md:grid" />
            <Reveal className="rotate-1 transition-transform duration-300 ease-[var(--ease-quart)] hover:rotate-0">
              <LiveDemo />
            </Reveal>
          </div>
        </div>
      </Section>

      {/* ── Buttr intro (the guide says bonjour) ────────────── */}
      <Section tone="cream" innerClassName="max-w-6xl py-0 pb-10">
        <ButtrSays img="/brand/buttr-beret.webp">
          bonjour — i&apos;m Buttr. that&apos;s me answering up there. yes, a croissant runs your
          support now. it&apos;s going great, actually. 🥐
        </ButtrSays>
      </Section>

      {/* ── Cost band (ACID — loud) ─────────────────────────── */}
      <Section
        tone="acid"
        innerClassName="flex max-w-6xl flex-col items-center justify-center gap-6 py-14 text-center sm:flex-row sm:gap-12 sm:text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/buttr-chill.webp"
          alt="Buttr the croissant, unbothered"
          width={112}
          height={112}
          className="size-28 shrink-0 object-contain"
        />
        <p className="max-w-md font-mono text-sm font-semibold text-espresso/80">
          paying{" "}
          <span className="text-espresso line-through decoration-jam decoration-2">
            $100–400/mo
          </span>{" "}
          for a chat widget and a login your customers never asked for?
        </p>
        <Reveal className="font-display text-5xl font-black tracking-tight text-espresso sm:text-6xl">
          krispy is <span className="rounded-lg bg-espresso px-3 py-1 text-acid">$0</span>.
        </Reveal>
      </Section>

      {/* ── Social proof (open source · stars · one command) ── */}
      <Section tone="surface" innerClassName="max-w-6xl py-12">
        <div className="grid items-center gap-8 text-center sm:grid-cols-3 sm:text-left">
          <a
            href={GITHUB_URL}
            className={`flex flex-col items-center gap-2 sm:items-start ${FOCUS}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={STARS_BADGE}
              alt="Krispy on GitHub — star count"
              height={32}
              className="h-8"
            />
            <span className="font-mono text-xs text-muted-foreground">
              star it — help another dev find the open one
            </span>
          </a>
          <div className="flex flex-col items-center gap-1 sm:items-start sm:border-l-2 sm:border-espresso/10 sm:pl-8">
            <span className="font-display text-2xl font-black tracking-tight">MIT open source</span>
            <span className="font-mono text-xs text-muted-foreground">
              read every line — no black box
            </span>
          </div>
          <div className="flex flex-col items-center gap-1 sm:items-start sm:border-l-2 sm:border-espresso/10 sm:pl-8">
            <span className="font-display text-2xl font-black tracking-tight">
              self-host in one command
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              Cloudflare free tier · no API key
            </span>
          </div>
        </div>
      </Section>

      {/* ── How it works (ESPRESSO room) ────────────────────── */}
      <Section tone="espresso" id="how">
        <div className="mb-14 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-acid">
            how it works · voilà
          </span>
          <h2 className="max-w-2xl font-display text-4xl font-black leading-[0.95] tracking-tight text-balance sm:text-6xl">
            a bot that knows when to get you
          </h2>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="group flex flex-col items-start gap-4 rounded-[14px] border-2 border-cream bg-espresso p-7 shadow-[6px_6px_0_0_var(--cream)] transition-transform duration-300 ease-[var(--ease-quart)] hover:-translate-x-0.5 hover:-translate-y-0.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.img}
                alt={s.title}
                width={96}
                height={96}
                className="size-24 object-contain"
              />
              <span className="font-mono text-3xl font-black text-acid">{s.n}</span>
              <h3 className="font-display text-2xl font-bold tracking-tight">{s.title}</h3>
              <p className="text-sm text-cream/70">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <ButtrSays img="/brand/buttr-sparkle.webp" dark>
            i handle the easy 3am questions so you can sleep. i don&apos;t sleep. i&apos;m bread. 🥐
          </ButtrSays>
        </div>
      </Section>

      {/* ── Comparison (cream) ──────────────────────────────── */}
      <Section tone="cream" id="compare" innerClassName="max-w-4xl">
        <div className="mb-12 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
            the honest table
          </span>
          <h2 className="font-display text-4xl font-black tracking-tight sm:text-6xl">
            krispy vs the usual
          </h2>
        </div>
        <Card variant="sticker" className="gap-0 overflow-hidden rounded-[14px] p-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-espresso bg-butter/50">
                <th className="p-4 text-left">
                  <span className="sr-only">Feature</span>
                </th>
                <th className="p-4 text-center font-display text-lg font-black text-jam">
                  krispy 🥐
                </th>
                <th className="p-4 text-center font-mono text-xs font-medium text-muted-foreground">
                  Intercom
                </th>
                <th className="p-4 text-center font-mono text-xs font-medium text-muted-foreground">
                  Chatwoot
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="p-4 text-left font-medium text-foreground">{row.label}</td>
                  <td className="bg-acid/15 p-4 text-center">
                    <Cell v={row.krispy} />
                  </td>
                  <td className="p-4 text-center">
                    <Cell v={row.intercom} />
                  </td>
                  <td className="p-4 text-center">
                    <Cell v={row.chatwoot} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="mt-8">
          <ButtrSays img="/brand/buttr-shrug.webp">
            no shade — just facts. Intercom&apos;s great at being Intercom. i&apos;m just free, and
            i live on your box. 🥐
          </ButtrSays>
        </div>
      </Section>

      {/* ── Who it's for (SURFACE · numbered editorial) ─────── */}
      <Section tone="surface" innerClassName="max-w-5xl">
        <div className="mb-12 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
            who it&apos;s for · à qui
          </span>
          <h2 className="font-display text-4xl font-black tracking-tight sm:text-6xl">
            built for people who ship
          </h2>
        </div>
        <div className="grid gap-x-10 gap-y-10 sm:grid-cols-3">
          {WHO.map((w) => (
            <div key={w.n} className="border-t-2 border-espresso pt-4">
              <span className="font-mono text-sm font-black text-crust">{w.n}</span>
              <h3 className="mt-1 font-display text-2xl font-bold tracking-tight">{w.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{w.b}</p>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <ButtrSays img="/brand/buttr-chill.webp">
            not an enterprise support org trying to talk to customers less? good. wrong bakery. 🥐
          </ButtrSays>
        </div>
      </Section>

      {/* ── Why Krispy (JAM room) ───────────────────────────── */}
      <Section tone="jam" className="relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/buttr-heart.webp"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -right-6 size-44 rotate-6 object-contain opacity-90 md:size-56"
        />
        <div className="mb-12 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-acid">
            why krispy
          </span>
          <h2 className="max-w-2xl font-display text-4xl font-black leading-[0.95] tracking-tight text-balance sm:text-6xl">
            the bot&apos;s the first touch, never the last word
          </h2>
        </div>
        <div className="grid max-w-3xl gap-x-10 gap-y-10 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.n} className="border-t-2 border-cream/40 pt-4">
              <span className="font-mono text-sm font-black text-acid">{f.n}</span>
              <h3 className="mt-1 font-display text-2xl font-bold tracking-tight">{f.t}</h3>
              <p className="mt-1 text-sm text-cream/80">{f.b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Install (ESPRESSO room · cream receipt) ─────────── */}
      <Section tone="espresso" innerClassName="max-w-2xl">
        <div className="mb-8">
          <ButtrSays img="/brand/buttr-chill.webp" dark>
            took me 2 minutes to self-host. and i&apos;m a croissant. you&apos;ll be fine. 🥐
          </ButtrSays>
        </div>
        <Receipt total="$0.00">
          <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-foreground">
            <code>
              <span className="text-fresh">$</span> git clone{" "}
              {`https://github.com/lonormaly/krispyai`}
              {"\n"}
              <span className="text-fresh">$</span> cd krispyai && bun install
              {"\n"}
              <span className="text-fresh">$</span> bun run edge:deploy{" "}
              <span className="text-muted-foreground"># live on Cloudflare, free</span>
            </code>
          </pre>
        </Receipt>
      </Section>

      {/* ── Le Menu (id=cloud · the money-maker) ────────────── */}
      {/* ponytail: trial CTA reuses CLOUD_URL (prod → app.krispy). Locally #cloud self-scrolls. */}
      <Section tone="muted" id="cloud" innerClassName="max-w-5xl">
        <div className="mb-12 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
            le menu · choisissez
          </span>
          <h2 className="font-display text-4xl font-black tracking-tight sm:text-6xl">
            own it, or let us run it
          </h2>
          <p className="max-w-xl text-lg font-medium text-muted-foreground">
            Own the method — it&apos;s open source, free forever. Or pay us to never think about
            hosting again. No per-seat tax either way.
          </p>
        </div>

        <div className="grid items-start gap-6 md:grid-cols-2">
          {/* Self-host — free */}
          <Card variant="sticker" className="gap-0 rounded-[16px] p-8">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
              01 · pour les bricoleurs
            </span>
            <h3 className="mt-3 font-display text-3xl font-black tracking-tight">Self-host</h3>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-5xl font-black text-espresso">GRATUIT</span>
              <span className="font-mono text-sm text-muted-foreground">$0 · forever</span>
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-foreground">
              {[
                "MIT license — read & fork every line",
                "You run it on Cloudflare's free tier",
                "Your data never leaves your box",
                "Community support on Discord",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="font-black text-fresh">✓</span>
                  {x}
                </li>
              ))}
            </ul>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="mt-8 w-full border-2 border-espresso bg-transparent font-mono font-semibold text-espresso hover:bg-acid hover:text-espresso"
            >
              <a href={GITHUB_URL}>Self-host free →</a>
            </Button>
            <p className="mt-3 text-center font-mono text-xs text-muted-foreground">
              for the tinkerers.
            </p>
          </Card>

          {/* Krispy Cloud — the hero (how we make money) */}
          <div className="relative rounded-[16px] border-2 border-espresso bg-espresso p-8 text-cream shadow-[8px_8px_0_0_var(--gold)] md:-translate-y-3">
            <span className="absolute -top-3 right-6 rounded-full border-2 border-espresso bg-acid px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-espresso">
              ★ recommended
            </span>
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-acid">
              02 · pour les gens occupés
            </span>
            <h3 className="mt-3 font-display text-3xl font-black tracking-tight">Krispy Cloud</h3>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="font-display text-6xl font-black text-gold">$19</span>
              <span className="font-mono text-sm text-cream/70">/mo</span>
            </p>
            <p className="font-mono text-sm text-fresh">14-day free trial · no credit card</p>
            <ul className="mt-6 space-y-2.5 text-sm text-cream/90">
              {[
                "We host, scale & auto-update it — zero ops",
                "No terminal, no server to babysit",
                "One flat price — no per-seat tax, ever",
                "Cancel anytime, export your data",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="font-black text-fresh">✓</span>
                  {x}
                </li>
              ))}
            </ul>
            <Button
              asChild
              size="lg"
              className="mt-8 w-full border-2 border-cream bg-gold font-mono font-semibold text-espresso transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-gold-hover hover:text-espresso"
            >
              <a href={CLOUD_URL}>Start free trial →</a>
            </Button>
            <p className="mt-3 text-center font-mono text-xs text-cream/50">
              for the busy. * launch pricing, may change.
            </p>
          </div>
        </div>

        <div className="mt-12">
          <ButtrSays img="/brand/buttr-shrug.webp">
            not into terminals? i gotchu — i&apos;ll run it, you just reply. it&apos;s cheaper than
            the coffee you dip me in. 🥐
          </ButtrSays>
        </div>
      </Section>

      {/* ── FAQ (cream · answer-first, JSON-LD) ─────────────── */}
      <Section tone="cream" id="faq" innerClassName="max-w-3xl">
        <div className="mb-12 flex flex-col items-start gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
            questions · les questions
          </span>
          <h2 className="font-display text-4xl font-black tracking-tight sm:text-6xl">
            the honest answers
          </h2>
        </div>
        <dl className="flex flex-col">
          {FAQ.map((f, i) => (
            <div key={f.q} className="border-t-2 border-espresso py-6 last:border-b-2">
              <dt className="flex gap-3 font-display text-xl font-bold tracking-tight">
                <span className="font-mono text-sm font-black text-crust">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {f.q}
              </dt>
              <dd className="mt-2 pl-8 text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10">
          <ButtrSays img="/brand/buttr-peek.webp">
            still deciding? the code&apos;s right there — read it, then decide. i&apos;ll wait. 🥐
          </ButtrSays>
        </div>
      </Section>

      {/* ── Blog (cream) ────────────────────────────────────── */}
      <Section tone="cream" className="relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/buttr-peek.webp"
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-4 left-0 hidden w-32 object-contain lg:block"
        />
        <div className="mb-10 flex items-end justify-between">
          <h2 className="font-display text-3xl font-black tracking-tight sm:text-5xl">
            learn the method
          </h2>
          <a
            href={BLOG_URL}
            className={`font-mono text-sm font-medium text-muted-foreground hover:text-jam ${FOCUS}`}
          >
            all posts →
          </a>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {POSTS.map((p) => (
            <a
              key={p.slug}
              href={`${BLOG_URL}/${p.slug}`}
              className={`group flex flex-col gap-2 rounded-[14px] border-2 border-espresso bg-card p-5 shadow-[6px_6px_0_0_var(--espresso)] transition-transform duration-300 ease-[var(--ease-quart)] hover:-translate-x-0.5 hover:-translate-y-0.5 ${FOCUS}`}
            >
              <h3 className="font-display text-lg font-bold leading-tight tracking-tight group-hover:text-jam">
                {p.title}
              </h3>
              <p className="text-sm text-muted-foreground">{p.blurb}</p>
            </a>
          ))}
        </div>
      </Section>

      {/* ── Final CTA (ESPRESSO closer) ─────────────────────── */}
      <section id="ship" className="bg-cream px-6 pb-16 pt-16">
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-[16px] border-2 border-espresso bg-espresso px-6 py-20 text-center text-cream shadow-[8px_8px_0_0_var(--jam)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/buttr-sparkle.webp"
            alt=""
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-4 size-28 rotate-12 object-contain opacity-90"
          />
          <span className="inline-flex items-center gap-2 rounded-full bg-acid px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-espresso">
            let the bot cook 🥐
          </span>
          <h2 className="max-w-2xl font-display text-4xl font-black leading-[0.9] tracking-tight text-balance sm:text-7xl">
            ship a chat that actually gets you
          </h2>
          <p className="max-w-md font-medium text-cream/70">
            Self-host it free, or let us run it — Krispy Cloud, free tier, live in two minutes.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="border-2 border-espresso bg-acid font-mono text-base font-semibold text-espresso shadow-[4px_4px_0_0_var(--cream)] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-acid hover:text-espresso hover:shadow-[2px_2px_0_0_var(--cream)]"
            >
              <a href={GITHUB_URL}>Self-host free</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-2 border-cream/40 bg-transparent font-mono text-base font-semibold text-cream hover:bg-white/10 hover:text-cream"
            >
              <a href={CLOUD_URL}>Try Krispy Cloud</a>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer (Buttr waves goodbye) ────────────────────── */}
      <footer className="border-t-2 border-espresso bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="mb-10 flex flex-col items-center gap-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/buttr-wave.webp"
              alt="Buttr waving goodbye"
              width={96}
              height={96}
              className="size-24 object-contain"
            />
            <p className="font-display text-2xl font-black tracking-tight">
              à bientôt — now go ship something.
            </p>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
            <span className="font-medium">krispy — the ai answers, you tag in.</span>
            <div className="flex gap-6 font-mono text-xs">
              <a href={GITHUB_URL} className={`hover:text-jam ${FOCUS}`}>
                GitHub
              </a>
              <a href={BLOG_URL} className={`hover:text-jam ${FOCUS}`}>
                Blog
              </a>
              <Link href="/privacy" className={`hover:text-jam ${FOCUS}`}>
                Privacy
              </Link>
              <span>MIT</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
