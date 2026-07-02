import { existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Badge, ButtrSays, Card, Stamp } from "@krispy/ui";
import { breadcrumbJsonLd, JsonLd, pageMetadata, websiteJsonLd } from "@krispy/seo";
import { getAllPosts, type Post } from "../lib/posts";
import { BlogFooter, BlogNav } from "./chrome";
import { BLOG_DESCRIPTION, BLOG_NAME, SITE_URL } from "./seo";

// This page's canonical metadata — one door (@krispy/seo). Layout owns the site default
// + `%s` template; this pins the "/" canonical + OG for the index route.
export const metadata = pageMetadata({
  description: BLOG_DESCRIPTION,
  tagline: "fresh takes on live chat, support & self-hosting",
  path: "/",
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// SSG-time hero lookup — some posts ship without a hero PNG; return null so the card
// renders a bold color-block instead of a broken image.
function heroFor(slug: string): string | null {
  const rel = `/blog/${slug}-hero.png`;
  return existsSync(join(process.cwd(), "public", rel)) ? rel : null;
}

/** Bold placeholder for hero-less posts — an acid color-block with a Buttr peek, so the
 *  grid never shows a broken image and still reads loud. */
function HeroBlock({ post }: { post: Post }) {
  const hero = heroFor(post.slug);
  if (hero) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={hero}
        alt={post.title}
        className="aspect-[16/9] w-full border-b-2 border-espresso object-cover transition-transform duration-500 ease-[var(--ease-quart)] group-hover:scale-[1.03]"
      />
    );
  }
  return (
    <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-b-2 border-espresso bg-acid">
      <span className="px-6 text-center font-display text-2xl font-black leading-tight tracking-tight text-espresso">
        {post.title}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/blog/buttr-reading.png"
        alt=""
        aria-hidden
        className="absolute -bottom-3 -right-3 size-20 rotate-6 object-contain opacity-90"
      />
    </div>
  );
}

/** A post as a bold sticker card — hero on top, Fraunces title, tags. The grid unit. */
function PostCard({ post }: { post: Post }) {
  return (
    <Card variant="sticker" className="group gap-0 overflow-hidden py-0">
      <Link href={`/${post.slug}`} className="flex h-full flex-col">
        <HeroBlock post={post} />
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-center gap-2 font-mono text-[11px] font-medium text-muted-foreground">
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.author}</span>
          </div>
          <h3 className="font-display text-xl font-bold leading-[1.1] tracking-tight text-espresso group-hover:text-jam">
            {post.title}
          </h3>
          <p className="line-clamp-3 text-sm text-muted-foreground">{post.description}</p>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-espresso/20 bg-butter/50 px-2 py-0.5 font-mono text-[10px] font-medium text-crust"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </Card>
  );
}

export default function BlogIndex() {
  const posts = getAllPosts();
  const [featured, ...rest] = posts;
  if (!featured) return null; // never at build (content always present); satisfies TS.
  const comparisons = rest.filter((p) => p.type === "comparison");
  const guides = rest.filter((p) => p.type !== "comparison");
  const featuredHero = heroFor(featured.slug);

  // Rich-results structured data for the index: the site + a breadcrumb. Article JSON-LD
  // lives on each post page, not here.
  const structuredData = [
    websiteJsonLd({ name: BLOG_NAME, url: SITE_URL, description: BLOG_DESCRIPTION }),
    breadcrumbJsonLd([{ name: "Blog", url: `${SITE_URL}/` }]),
  ];

  return (
    <div className="overflow-x-clip bg-cream">
      <JsonLd data={structuredData} />
      <BlogNav />

      {/* ── Masthead ─────────────────────────────────────────── */}
      <section className="relative bg-cream">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-10 pt-14 md:grid-cols-[1.15fr_0.85fr] md:pt-20">
          <div className="flex flex-col items-start">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-espresso bg-acid px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-espresso shadow-[3px_3px_0_0_var(--espresso)]">
              fresh takes · straight from the oven 🥐
            </span>
            <h1 className="mt-6 font-display font-black leading-[0.82] tracking-[-0.03em] text-balance text-[clamp(3rem,9vw,6.5rem)]">
              the krispy
              <br />
              <span className="text-jam">blog.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium text-muted-foreground">
              {BLOG_DESCRIPTION}
            </p>
            <div className="mt-8">
              <ButtrSays img="/blog/buttr-reading.png">
                bonjour — Buttr here. i read the whole internet so you don&apos;t have to. these are
                the good bits. 🥐
              </ButtrSays>
            </div>
          </div>

          {/* Bold "cover" panel — the masthead's screenshot-bait, mirrors the landing's
              dense hero right column. Espresso room + big Buttr + an issue-slip label. */}
          <div className="relative hidden md:block">
            <Stamp className="absolute -right-7 -top-7 z-20 bg-cream" />
            <div className="relative overflow-hidden rounded-[16px] border-2 border-espresso bg-espresso p-8 text-cream shadow-[8px_8px_0_0_var(--jam)]">
              <div className="flex items-center gap-3 border-b border-dashed border-cream/25 pb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-acid">
                <span>issue no. 01</span>
                <span className="text-cream/40">· the open support stack</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/blog/buttr-reading.png"
                alt="Buttr the croissant mascot, reading the field notes"
                className="mx-auto my-4 size-44 object-contain"
              />
              <p className="text-center font-display text-3xl font-black leading-[0.95] tracking-tight">
                field notes for people who <span className="text-acid">ship</span>.
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-dashed border-cream/25 pt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-crust">
                <span>self-hosted · MIT</span>
                <span className="text-jam">$0.00</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Featured (à la une) ──────────────────────────────── */}
      <section className="bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
            à la une · featured
          </span>
          <Card
            variant="sticker"
            className="group mt-4 gap-0 overflow-hidden py-0 md:grid md:grid-cols-2"
          >
            <Link href={`/${featured.slug}`} className="contents">
              {featuredHero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={featuredHero}
                  alt={featured.title}
                  className="aspect-[16/10] w-full border-b-2 border-espresso object-cover transition-transform duration-500 ease-[var(--ease-quart)] group-hover:scale-[1.02] md:aspect-auto md:h-full md:border-b-0 md:border-r-2"
                />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center border-b-2 border-espresso bg-jam md:aspect-auto md:h-full md:border-b-0 md:border-r-2">
                  <span className="px-8 text-center font-display text-3xl font-black text-cream">
                    {featured.title}
                  </span>
                </div>
              )}
              <div className="flex flex-col justify-center gap-4 p-7 md:p-10">
                <div className="flex items-center gap-2 font-mono text-[11px] font-medium text-muted-foreground">
                  <time dateTime={featured.date}>{formatDate(featured.date)}</time>
                  <span aria-hidden>·</span>
                  <span>{featured.author}</span>
                </div>
                <h2 className="font-display text-3xl font-black leading-[1.02] tracking-tight text-espresso group-hover:text-jam sm:text-4xl">
                  {featured.title}
                </h2>
                <p className="text-muted-foreground">{featured.description}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {featured.tags.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <span className="mt-2 font-mono text-sm font-semibold text-jam">read it →</span>
              </div>
            </Link>
          </Card>
        </div>
      </section>

      {/* ── The honest comparisons (warm-paper band) ─────────── */}
      {comparisons.length > 0 && (
        <section className="border-t-2 border-espresso bg-muted">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="mb-8 flex flex-col items-start gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
                the honest comparisons
              </span>
              <h2 className="font-display text-3xl font-black tracking-tight sm:text-5xl">
                krispy vs the usual
              </h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {comparisons.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Field notes & guides (cream band) ────────────────── */}
      <section className="border-t-2 border-espresso bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-8 flex flex-col items-start gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-crust">
              field notes &amp; guides
            </span>
            <h2 className="font-display text-3xl font-black tracking-tight sm:text-5xl">
              build it, own it, ship it
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Read-the-source CTA (espresso closer) ────────────── */}
      <section className="bg-cream px-6 pb-16 pt-8">
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-5 overflow-hidden rounded-[16px] border-2 border-espresso bg-espresso px-6 py-16 text-center text-cream shadow-[8px_8px_0_0_var(--jam)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/blog/buttr-thinking.png"
            alt=""
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-4 size-24 rotate-12 object-contain opacity-90"
          />
          <span className="inline-flex items-center gap-2 rounded-full bg-acid px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-espresso">
            let the bot cook 🥐
          </span>
          <h2 className="max-w-2xl font-display text-3xl font-black leading-[0.95] tracking-tight text-balance sm:text-5xl">
            stop reading. start shipping.
          </h2>
          <p className="max-w-md font-medium text-cream/70">
            Krispy is the open-source AI live chat that answers in your voice and taps you in on
            Telegram. Self-host it free.
          </p>
          <a
            href={process.env.NEXT_PUBLIC_LANDING_URL ?? "http://landing.krispy.localhost:1355"}
            className="mt-2 inline-flex items-center gap-2 rounded-md border-2 border-espresso bg-acid px-6 py-3 font-mono text-base font-semibold text-espresso shadow-[4px_4px_0_0_var(--cream)] transition-transform hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_0_var(--cream)]"
          >
            meet Krispy →
          </a>
        </div>
      </section>

      <BlogFooter />
    </div>
  );
}
